import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { buildJianyingAIRequest, requestJianyingAI } from '../app/electron/jianying-ai.mjs';
import { createQuickLaunch } from '../app/electron/quick-launch.mjs';
import { splitScript } from '../app/shared/script-score.mjs';

const connection = { provider: { protocol: 'gemini', baseUrl: 'https://example.com/v1beta', apiKey: 'secret-fixture' }, model: 'gemini-test' };
test('existing Gemini/relay connections carry images correctly and keys never go in request bodies', async () => {
  const native = buildJianyingAIRequest(connection, { prompt: 'test', image: 'YWJj' });
  assert.match(native.url.pathname, /v1beta\/models\/gemini-test:generateContent$/);
  assert.equal(native.body.contents[0].parts[1].inlineData.data, 'YWJj'); assert.doesNotMatch(JSON.stringify(native.body), /secret-fixture/);
  const relay = { ...connection, provider: { ...connection.provider, protocol: 'openai', baseUrl: 'https://example.com/v1/chat/completions' } };
  const request = buildJianyingAIRequest(relay, { prompt: 'test', image: 'YWJj' });
  assert.equal(request.url.pathname, '/v1/chat/completions'); assert.match(request.body.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  let calls = 0;
  const output = await requestJianyingAI(connection, { prompt: 'test' }, null, async () => { calls++; return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }) }; });
  assert.equal(output, '[]'); assert.equal(calls, 1);
  await assert.rejects(requestJianyingAI(connection, { prompt: 'test' }, null, async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Bad secret-fixture' } }) })), error => !error.message.includes('secret-fixture') && error.message.includes('401'));
});
test('quick folders persist eight entries, only configured folders open, removal never deletes contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-quick-test-'));
  try {
    let count = 0; const opened = [];
    const options = { settingsFile: path.join(root, 'quick.json'), shell: { openPath: async value => { opened.push(value); return ''; } }, chooseDirectory: async () => { const folder = path.join(root, String(++count)); await fs.mkdir(folder); return folder; }, discover: async () => [] };
    const quick = createQuickLaunch(options); let state;
    const additions = await Promise.allSettled(Array.from({ length: 10 }, () => quick.addFolder()));
    assert.equal(additions.filter(item => item.status === 'fulfilled').length, 8);
    assert.equal(count, 8, 'extra concurrent clicks do not open extra dialogs or lose saved folders');
    state = await quick.scan();
    assert.equal(state.folders.length, 8); await assert.rejects(quick.addFolder(), /八个/);
    await quick.openFolder(state.folders[0].id); assert.deepEqual(opened, [state.folders[0].path]);
    await assert.rejects(quick.openFolder('unconfigured'), /不存在/);
    const persisted = await createQuickLaunch(options).scan(); assert.equal(persisted.folders.length, 8);
    await quick.removeFolder(state.folders[0].id); assert.equal((await fs.stat(state.folders[0].path)).isDirectory(), true);
    await assert.rejects(quick.launch(), /未找到/); assert.equal(opened.length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('shortcut launch uses only a discovered existing executable and never launches during detection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-launch-test-'));
  try {
    const file = path.join(root, 'JianyingPro.exe'); await fs.writeFile(file, 'fixture-not-executable');
    const opened = []; const quick = createQuickLaunch({ settingsFile: path.join(root, 'settings.json'), discover: async () => [{ path: file }], shell: { openPath: async value => { opened.push(value); return ''; } } });
    await quick.scan(); assert.equal(opened.length, 0); await assert.rejects(quick.select('C:/arbitrary.exe'), /重新检测/);
    await quick.select(file); await quick.launch(); assert.deepEqual(opened, [file]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('subtitle punctuation survives line breaks, including a trailing comma', () => {
  const lines = splitScript('[EN] A: Hello,\n[EN] B: Go.\n[EN] A: Wait... No,.');
  assert.equal(lines[0].text, 'Hello,'); assert.ok(lines.some(line => line.text === 'Go.'));
  assert.equal(lines.map(line => line.text).join(' ').replace(/\s/g, ''), 'Hello,Go.Wait...No,.');
});

const saved = new Map();
globalThis.localStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
globalThis.i = { createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...(props || {}), children }) : ({ type, props: props || {}, children }), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect: () => {}, useMemo: fn => fn(), useRef: value => ({ current: value }), useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
const compiled = await build({ entryPoints: ['app/src/upgrade.jsx'], bundle: true, write: false, platform: 'browser', format: 'esm', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function nodes(tree, predicate) { if (!tree || typeof tree !== 'object') return []; return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flat(Infinity).flatMap(child => nodes(child, predicate))]; }
const textOf = tree => (tree?.children || []).flat(Infinity).map(child => typeof child === 'object' ? textOf(child) : child ?? '').join('');
test('sixth page exposes four separately collapsible panels and reuses existing provider choices', () => {
  const tree = ui.JianyingStudio({ active: true, providers: [{ id: 'existing', name: '已有连接', protocol: 'openai', models: ['gemini-test'], apiKey: 'hidden-key' }], onNavigate: () => {} });
  const toggles = nodes(tree, node => node.type === 'button' && node.props['aria-controls']?.startsWith('jy-'));
  assert.equal(toggles.length, 4); assert.equal(new Set(toggles.map(item => item.props['aria-controls'])).size, 4);
  assert.match(textOf(tree), /已有连接/); assert.doesNotMatch(textOf(tree), /hidden-key/);
  const exportPanel = nodes(tree, node => node.props.id === 'jy-export')[0];
  const connections = nodes(tree, node => node.props.id === 'jy-settings')[0];
  assert.match(textOf(exportPanel), /导出模式与参数/); assert.match(textOf(exportPanel), /保存等待时间/);
  assert.match(textOf(exportPanel), /导出 → 确认导出 → 关闭导出界面 → 关闭草稿/);
  assert.doesNotMatch(textOf(exportPanel), /F9/);
  assert.doesNotMatch(textOf(connections), /坐标模板|保存等待时间/);
  const optionsToggle = nodes(exportPanel, node => node.props['aria-controls'] === 'bos-jy-export-options-body')[0];
  assert.equal(optionsToggle.props['aria-expanded'], true);
});
test('four top stage cards select their own Jianying section and persist the choice', () => {
  globalThis.document = { querySelector: () => null };
  const tree = ui.JianyingStudio({ active: true, providers: [], onNavigate: () => {} });
  const tabs = nodes(tree, node => node.type === 'button' && node.props.role === 'tab' && node.props.className?.includes('bos-stage-tab'));
  assert.equal(tabs.length, 4);
  for (const [index, stage] of ['export', 'subtitles', 'rename', 'watermark'].entries()) {
    assert.match(textOf(tabs[index]), new RegExp(['批量导出', '字幕工程', '批量改名', '样片水印'][index]));
    tabs[index].props.onClick();
    assert.equal(saved.get('xm.jianying.stage'), stage);
  }
});
test('workspace removes music requirements and SRT restoration while preserving direct-copy fallback', () => {
  globalThis.window = { location: { origin: 'http://127.0.0.1:37651' } };
  const tree = ui.ScriptAutomation({ providers: [], automation: { queue: {}, jobs: [], running: false }, onNavigate: () => {} });
  assert.doesNotMatch(textOf(tree), /配乐要求|选择 SRT|下载标点还原/);
  assert.match(textOf(tree), /原工具方式/); assert.match(textOf(tree), /复制到剪映/);
});
test('draft scanning offers DeepSeek without API while the rename model stays Gemini', () => {
  saved.set('xm.jianying.scan-model', 'webai:deepseek::DeepSeek');
  const tree = ui.JianyingStudio({ active: true, providers: [], onNavigate: () => {} });
  const select = nodes(tree, node => node.type === 'select' && node.props['aria-label'] === '草稿扫描模型')[0];
  assert.equal(select.props.value, 'webai:deepseek::DeepSeek');
  assert.match(textOf(select), /DeepSeek.*无需 API/);
  assert.match(textOf(tree), /复用.*登录账号/);
  const settings = nodes(tree, node => node.props.id === 'jy-settings')[0];
  assert.doesNotMatch(textOf(settings), /DeepSeek/);
  saved.delete('xm.jianying.scan-model');
});
test('right rail displays eight-folder capacity and an accessible resize handle', () => {
  const rail = ui.QuickRail(); assert.match(textOf(rail), /0 \/ 8/); assert.match(textOf(rail), /自动隐藏/);
  const handle = ui.SidebarResizer(); assert.equal(handle.props.role, 'separator'); assert.equal(handle.props['aria-orientation'], 'vertical');
  saved.set('xm.layout.v1', JSON.stringify({ autoHideRail: true }));
  const hidden = ui.QuickRail();
  const content = nodes(hidden, node => node.props.id === 'bos-quickrail-content')[0];
  assert.equal(content.props.inert, true); assert.equal(content.props['aria-hidden'], true);
  assert.equal(nodes(hidden, node => node.type === 'button' && node.props['aria-label'] === '展开快捷栏').length, 1);
  saved.delete('xm.layout.v1');
});
