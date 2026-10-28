import test from 'node:test';
import assert from 'node:assert/strict';

import { createJianyingWebScan } from '../app/electron/jianying-web-scan.mjs';

function fixture(overrides = {}) {
  let time = 0, seq = 0, sent = false;
  const calls = [], reports = [], notifications = [], copies = [];
  const controller = new AbortController();
  const driver = createJianyingWebScan({
    driver: {
      visible: () => overrides.visible ? overrides.visible() : true,
      run: async (provider, input) => {
        assert.equal(provider, 'deepseek'); calls.push(input);
        if (overrides.run) return overrides.run(input);
        if (input.command === 'prepare-image') { sent = false; return { state: 'uploaded', upload: { filename: input.filename, before: ['logo'] } }; }
        if (input.command === 'image-ready') return { state: 'ready' };
        if (input.command === 'send') { sent = true; return { state: 'sent' }; }
        return { texts: sent ? [JSON.stringify({ xmTaskId: input.token, result: { drafts: [] } })] : [], busy: false, pendingPrompt: !sent };
      },
    },
    notify: task => notifications.push(task), copy: async text => { copies.push(text); return { copyVerified: true }; },
    isBusy: overrides.isBusy || (() => false),
    now: () => time, uuid: () => `scan-test-${++seq}`,
    delay: async ms => { time += ms; await overrides.delay?.(controller); },
    pageTimeoutMs: overrides.pageTimeoutMs || 50, uploadTimeoutMs: overrides.uploadTimeoutMs || 90000,
  });
  const request = () => driver.request({ prompt: 'Find actual drafts', image: 'YWJj' }, controller.signal, message => reports.push(message));
  return { driver, controller, request, calls, reports, notifications, copies };
}
test('DeepSeek shares the embedded page across both screenshot phases and prepares one question per image', async () => {
  const f = fixture();
  assert.equal(await f.request(), '{"drafts":[]}');
  assert.equal(await f.request(), '{"drafts":[]}');
  assert.equal(f.calls.filter(x => x.command === 'send').length, 2);
  assert.equal(f.calls.filter(x => x.command === 'prepare-image').length, 2);
  assert.equal(f.calls.some(x => x.command === 'fill'), false);
  assert.equal(new Set(f.calls.filter(x => x.command === 'prepare-image').map(x => x.filename)).size, 2);
  assert.ok(f.calls.filter(x => x.command === 'image-ready').every(x => x.upload.filename === x.filename));
  assert.equal(f.driver.snapshot().kind, 'draft-scan');
  assert.equal(f.driver.snapshot().provider, 'deepseek');
  f.driver.close(); assert.equal(f.notifications.at(-1), null);
});
test('login wait can be cancelled without sending or uploading', async () => {
  const f = fixture({ run: async () => ({ state: 'login', message: '请登录' }), delay: controller => controller.abort() });
  await assert.rejects(f.request(), /中断/);
  assert.equal(f.calls.some(x => x.command === 'send'), false);
  assert.ok(f.reports.some(x => x.includes('登录')));
  f.driver.dispose();
});

test('uncertain send and unsupported image mode are not retried', async () => {
  const f = fixture({ run: async input => {
    if (input.command === 'prepare-image') return { state: 'uploaded' };
    if (input.command === 'image-ready') return { state: 'ready' };
    if (input.command === 'read') return { texts: [], pendingPrompt: true };
    throw new Error('uncertain click');
  } });
  await assert.rejects(f.request(), /uncertain/);
  assert.equal(f.calls.filter(x => x.command === 'send').length, 1);
  f.driver.dispose();
  const g = fixture({ run: async () => ({ state: 'unsupported', message: '无法识别图片' }) });
  await assert.rejects(g.request(), /无法识别图片/); assert.equal(g.calls.length, 1); g.driver.dispose();
});

test('aborted hanging page call and closed task terminate scan', async () => {
  const f = fixture({ run: async () => new Promise(() => {}), pageTimeoutMs: 10000 });
  const pending = f.request(); f.controller.abort();
  await assert.rejects(pending, /中断/); f.driver.dispose();
  const g = fixture({ delay: () => g.driver.close() });
  await assert.rejects(g.request(), /中断/); g.driver.dispose();
});

test('other task answers and busy streams cannot finish the current screenshot request', async () => {
  let reads = 0;
  const f = fixture({ run: async input => {
    if (input.command === 'prepare-image') return { state: 'uploaded' };
    if (input.command === 'image-ready') return { state: 'ready' };
    if (input.command === 'fill') return { state: 'filled' };
    if (input.command === 'send') return { state: 'sent' };
    reads++;
    return { busy: reads < 4, texts: [JSON.stringify({ xmTaskId: reads === 1 ? 'old-task' : input.token, result: { drafts: [] } })] };
  } });
  assert.equal(await f.request(), '{"drafts":[]}'); assert.ok(reads >= 5); f.driver.dispose();
});

test('unfinished attachment becomes an actionable manual state without resending or overwriting the page', async () => {
  let f;
  f = fixture({ uploadTimeoutMs: 3500, run: async input => input.command === 'prepare-image' ? { state: 'uploaded' } : input.command === 'image-ready' ? { state: 'uploading' } : { texts: [], busy: false, pendingPrompt: true }, delay: async () => {
    if (f.driver.snapshot()?.message.includes('无法确认')) await f.driver.action(f.driver.snapshot().id, 'import', '{"drafts":[]}');
  } });
  assert.equal(await f.request(), '{"drafts":[]}');
  assert.equal(f.calls.filter(x => x.command === 'prepare-image').length, 1);
  assert.equal(f.calls.some(x => x.command === 'send'), false);
  assert.ok(f.reports.some(x => x.includes('点击发送'))); f.driver.dispose();
});
test('upload must stay ready across polls before the prompt can be sent', async () => {
  let polls = 0;
  const f = fixture({ run: async input => {
    if (input.command === 'prepare-image') return { state: 'uploaded' };
    if (input.command === 'image-ready') return { state: ++polls === 2 ? 'uploading' : 'ready' };
    if (input.command === 'send') { assert.equal(polls, 4); return { state: 'sent' }; }
    return { texts: polls >= 4 ? [JSON.stringify({ xmTaskId: input.token, result: { drafts: [] } })] : [], pendingPrompt: polls < 4, busy: false };
  } });
  assert.equal(await f.request(), '{"drafts":[]}'); f.driver.dispose();
});

test('unaccepted send offers manual completion and never submits twice', async () => {
  let f;
  f = fixture({ run: async input => {
    if (input.command === 'prepare-image') return { state: 'uploaded' };
    if (input.command === 'image-ready') return { state: 'ready' };
    if (input.command === 'send') return { state: 'sent' };
    return { texts: [], busy: false, pendingPrompt: true };
  }, delay: async () => {
    if (f.driver.snapshot()?.message.includes('网页未接受')) await f.driver.action(f.driver.snapshot().id, 'import', '{"drafts":[]}');
  } });
  assert.equal(await f.request(), '{"drafts":[]}');
  assert.equal(f.calls.filter(x => x.command === 'send').length, 1);
  assert.ok(f.reports.some(x => x.includes('发送箭头'))); f.driver.dispose();
});

test('another web task blocks screenshot analysis before modifying the shared page', async () => {
  const f = fixture({ isBusy: () => true });
  await assert.rejects(f.request(), /已有网页分析任务/);
  assert.equal(f.calls.length, 0); assert.equal(f.notifications.length, 0); f.driver.dispose();
});

test('hidden page waits, cancellation preserves the shared page and rejects old-task actions', async () => {
  const f = fixture({ visible: () => false, delay: controller => controller.abort() });
  await assert.rejects(f.request(), /中断/); assert.equal(f.calls.length, 0);
  f.driver.close(); await assert.rejects(f.driver.action('old', 'copy'), /已结束/); f.driver.dispose();
});

test('copying a scan task preserves the complete question and supports manual result import', async () => {
  let f, copied = false;
  f = fixture({ run: async () => ({ state: 'login', message: '请登录' }), delay: async () => {
    if (!copied) { copied = true; const task = f.driver.snapshot(); await f.driver.action(task.id, 'copy'); await f.driver.action(task.id, 'import', '{"heading":null}'); }
  } });
  assert.equal(await f.request(), '{"heading":null}');
  assert.ok(f.copies[0].includes('Find actual drafts')); assert.ok(f.copies[0].includes('scan-test-1')); f.driver.dispose();
});
