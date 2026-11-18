import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { companyDSHPageScript } from '../app/electron/company-dsh-dom.mjs';
import { createWebAnalysis } from '../app/electron/web-ai-analysis.mjs';
import { WEB_ANALYZERS } from '../app/shared/script-analyzers.mjs';
import { analysis } from './script-test-fixtures.mjs';

function fixture() {
  let clicks = 0, busy = false, answers = [], turns = [], editorsVisible = true;
  const visible = { getClientRects: () => [1], closest: () => null, getAttribute: () => null };
  class Textarea { constructor() { this._value = ''; this.tagName = 'TEXTAREA'; } get value() { return this._value; } set value(v) { this._value = v; } focus() {} dispatchEvent() {} }
  const send = { ...visible, getAttribute: key => key === 'aria-label' ? '发送' : null, click: () => { clicks++; } };
  const composer = { querySelectorAll: selector => selector.startsWith('button') ? [send] : [] };
  const editor = Object.assign(new Textarea(), visible, { closest: selector => selector === '[data-composer-card]' ? composer : null });
  const context = {
    URL, location: { hostname: '192.168.1.10', protocol: 'http:', pathname: '/' },
    HTMLTextAreaElement: Textarea, InputEvent: class {}, getComputedStyle: () => ({ visibility: 'visible', opacity: '1' }),
    document: { querySelectorAll: selector => selector.startsWith('[data-composer-input]') ? editorsVisible ? [editor] : [] : selector.startsWith('[data-chat-running]') ? busy ? [visible] : [] : selector.startsWith('[data-chat-group-part=') ? answers.map(text => ({ ...visible, cloneNode: () => ({ textContent: text, querySelectorAll: () => [] }) })) : turns.filter(node => selector === `[data-chat-flow-kind="${node.kind}"]`) },
  };
  const prompt = '请分析本集剧情\n\n保留中文理由。', token = 'fixture-token';
  return { editor, send, context, prompt, token, clicks: () => clicks, busy: value => { busy = value; }, answers: value => { answers = value; }, hideEditor: () => { editorsVisible = false; }, turns: rows => {
    turns = rows.map(({ kind, turn, text, hidden = false, quoted = false }) => ({ ...visible, kind, innerText: text,
      getClientRects: () => hidden ? [] : [1], getAttribute: key => key === 'data-chat-turn' ? turn : null,
      closest: selector => quoted && selector.includes('[data-chat-flow-kind="user"]') ? {} : null,
      querySelectorAll: () => [],
    }));
  }, run: command => vm.runInNewContext(companyDSHPageScript({ command, entryUrl: 'http://192.168.1.10:19999/', prompt, token }), context) };
}

test('company DSH appears as an automatic analyzer without a bundled internal address', () => {
  const model = WEB_ANALYZERS.find(item => item.provider.webId === 'dsh');
  assert.equal(model.baseUrl, ''); assert.match(model.label, /自动分析/);
});
test('DSH accepts allocated ports on its configured host, not identity pages or another host', () => {
  const f = fixture(); assert.equal(f.run('probe').state, 'ready');
  f.context.location.hostname = 'accounts.feishu.cn'; assert.equal(f.run('fill').state, 'login');
  f.context.location.hostname = '192.168.1.10'; f.context.location.pathname = '/auth/feishu'; assert.equal(f.run('fill').state, 'login');
  assert.equal(f.editor.value, ''); assert.equal(f.clicks(), 0);
});
test('DSH preserves unsent drafts and waits for existing generation before filling', () => {
  const f = fixture(); f.editor.value = '用户的草稿'; assert.equal(f.run('fill').state, 'draft'); assert.equal(f.editor.value, '用户的草稿');
  f.editor.value = ''; f.busy(true); assert.equal(f.run('fill').state, 'draft'); assert.equal(f.editor.value, '');
  f.busy(false); assert.equal(f.run('fill').state, 'filled'); assert.equal(f.editor.value, f.prompt);
  f.send.disabled = true; assert.equal(f.run('send').state, 'manual'); assert.equal(f.clicks(), 0);
  f.send.disabled = false; assert.equal(f.run('send').state, 'sent'); assert.equal(f.clicks(), 1);
});
test('DSH reads only current result and waits while streaming', () => {
  const f = fixture(); const reply = JSON.stringify({ xmTaskId: f.token, result: analysis });
  f.answers(['old reply', f.prompt + f.token, reply]); f.busy(true);
  const value = f.run('read'); assert.equal(value.busy, true); assert.deepEqual([...value.texts], [reply]);
});
test('DSH accepts visual paragraph spacing but still rejects changed words before sending', () => {
  const f = fixture(); f.editor.isContentEditable = true;
  f.editor.value = f.prompt.replace('\n\n', '\n\n\n'); assert.equal(f.run('send').state, 'sent');
  f.editor.value = f.prompt.replace('中文理由','英文理由'); assert.equal(f.run('send').state, 'manual'); assert.equal(f.clicks(), 1);
});
test('DSH waits for a deferred rich-text paste and never inserts a second copy', () => {
  const f = fixture(); f.editor.tagName = 'DIV'; f.editor.isContentEditable = true;
  f.context.DataTransfer = class { setData() {} };
  f.context.ClipboardEvent = class { constructor() { this.type = 'paste'; } preventDefault() { this.defaultPrevented = true; } };
  let pastes = 0;
  f.editor.dispatchEvent = event => { if (event.type === 'paste') { pastes++; event.preventDefault(); } };
  assert.equal(f.run('fill').state, 'input-pending'); assert.equal(f.editor.value, '');
  f.editor.value = f.prompt;
  assert.equal(f.run('fill').state, 'filled'); assert.equal(pastes, 1);
});

const deploymentError = 'unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"; registered variables: provider, model';

test('DSH reports the current turn configuration failure even when the editor disappears', () => {
  const f = fixture(); f.hideEditor();
  f.turns([{ kind: 'user', turn: '4', text: f.prompt + f.token }, { kind: 'turn-error', turn: '4', text: deploymentError }]);
  const result = f.run('read');
  assert.equal(result.state, 'failed'); assert.ok(result.message.includes(deploymentError));
  assert.match(result.message, /部署提示词配置有误/); assert.match(result.message, /不会自动重发/);
});

test('DSH ignores history errors, unrelated turns, hidden errors and quoted status markup', () => {
  const f = fixture(); const answer = JSON.stringify({ xmTaskId: f.token, result: analysis });
  f.turns([
    { kind: 'user', turn: '1', text: 'old task' }, { kind: 'turn-error', turn: '1', text: deploymentError },
    { kind: 'user', turn: '4', text: f.prompt + f.token + deploymentError },
    { kind: 'turn-error', turn: '4', text: deploymentError, hidden: true },
    { kind: 'turn-error', turn: '4', text: deploymentError, quoted: true },
    { kind: 'turn-error', turn: '5', text: deploymentError },
    { kind: 'turn-max-tokens', turn: '4', text: '输出达到上限' },
  ]);
  f.answers([answer]); assert.deepEqual([...f.run('read').texts], [answer]);
  assert.equal(f.run('fill').state, 'filled'); assert.equal(f.run('send').state, 'sent');
});

test('DSH does not associate errors without the current user task and a nonempty turn', () => {
  const f = fixture();
  for (const rows of [
    [{ kind: 'turn-error', turn: '4', text: deploymentError }],
    [{ kind: 'user', turn: '4', text: 'another task' }, { kind: 'turn-error', turn: '4', text: deploymentError }],
    [{ kind: 'user', turn: '', text: f.token }, { kind: 'turn-error', turn: '', text: deploymentError }],
  ]) { f.turns(rows); assert.equal(f.run('read').state, undefined); }
});

test('DSH preserves other current service errors without mislabeling them as configuration errors', () => {
  const f = fixture(); f.turns([{ kind: 'user', turn: '4', text: f.token }, { kind: 'turn-error', turn: '4', text: '上游模型暂时不可用' }]);
  const result = f.run('read'); assert.equal(result.state, 'failed'); assert.match(result.message, /上游模型暂时不可用/);
  assert.doesNotMatch(result.message, /部署提示词配置/);
});

test('DSH terminal failure stops immediately, clears the task and never sends a second request', async () => {
  for (const failureCommand of ['fill', 'send', 'read']) {
    let now = 0, sent = false; const calls = [];
    const host = createWebAnalysis({ uuid: () => 'failure-token', now: () => now, delay: async ms => { now += ms; }, copy: async () => {}, notify: () => {}, driver: {
      visible: () => true, run: async (_provider, input) => {
        calls.push(input.command);
        if (input.command === failureCommand && (failureCommand !== 'read' || sent)) return { state: 'failed', message: deploymentError };
        if (input.command === 'fill') return { state: 'filled' };
        if (input.command === 'send') { sent = true; return { state: 'sent' }; }
        return { texts: [], busy: false };
      },
    } });
    await assert.rejects(host.run({ id: 'dsh-failure-test', provider: 'dsh', purpose: 'library-match', input: { script: '雨夜重逢', tracks: [{ id: 'piano', title: '钢琴' }] } }), /unknown prompt variable/);
    assert.ok(now <= 3000); assert.equal(calls.filter(command => command === 'send').length, failureCommand === 'fill' ? 0 : 1);
    assert.equal(host.snapshot(), null);
  }
});
test('DSH submits analysis and matching once, one second after each fill, and returns Chinese reasons', async () => {
  let now = 0, round = 0; const sends = [], fills = [];
  const host = createWebAnalysis({ uuid: () => `company-task-${++round}`, now: () => now, delay: async ms => { now += ms; }, copy: async () => {}, notify: () => {}, driver: {
    visible: () => true,
    run: async (provider, command) => {
      assert.equal(provider, 'dsh');
      if (command.command === 'fill') { fills.push(now); return { state: 'filled' }; }
      if (command.command === 'send') { sends.push(now); return { state: 'sent' }; }
      return { texts: sends.length === round ? [JSON.stringify({ xmTaskId: command.token, result: round === 1 ? analysis : { matches: [{ id: 'piano', reason: '温暖钢琴承接重逢后的释然。', keywords: ['温暖'] }] } })] : [], busy: false };
    },
  } });
  const result = await host.run({ id: 'dsh-request-test', provider: 'dsh', purpose: 'library-match', input: { script: '两人重逢，相拥而泣。', tracks: [{ id: 'piano', title: '温暖钢琴' }] } });
  assert.equal(sends.length, 2); assert.equal(fills.length, 2);
  assert.deepEqual(sends.map((time, index) => time - fills[index]), [1000, 1000]);
  assert.match(result.matches[0].reason, /重逢/); assert.equal(host.snapshot(), null);
});

test('DSH cancellation during the one-second interval prevents automatic send', async () => {
  let waiting, resume;
  const paused = new Promise(resolve => { waiting = resolve; });
  const calls = [];
  const host = createWebAnalysis({ uuid: () => 'company-cancel', now: () => 0, delay: async ms => {
    assert.equal(ms, 1000);
    await new Promise(resolve => { resume = resolve; waiting(); });
  }, notify: () => {}, copy: async () => {}, driver: {
    visible: () => true,
    run: async (_provider, input) => {
      calls.push(input.command);
      return input.command === 'fill' ? { state: 'filled' } : { texts: [], busy: false };
    },
  } });
  const task = host.run({ id: 'dsh-cancel-interval', provider: 'dsh', purpose: 'library-match', input: { script: '两人重逢。', tracks: [{ id: 'piano', title: '钢琴' }] } });
  await paused;
  await host.action('dsh-cancel-interval', 'cancel'); resume();
  await assert.rejects(task, /中断/);
  assert.deepEqual(calls, ['fill', 'read']); assert.equal(host.snapshot(), null);
});
