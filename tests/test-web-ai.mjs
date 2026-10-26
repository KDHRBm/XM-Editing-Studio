import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';
import { createWebAIHost } from '../app/electron/web-ai-host.mjs';
import { WEB_AI_PROVIDERS, webAIProvider, isSecureWebURL, isWebAIPage, fitWebAIBounds, clipWebAISlot } from '../app/shared/web-ai.mjs';
import { webAIScriptPrompt } from '../app/shared/web-ai-prompts.mjs';
import { createPunctuationClipboard } from '../app/electron/period-clipboard.mjs';

function fixture() {
  const views = [], attached = new Set(), opened = [];
  class Contents extends EventEmitter {
    constructor() { super(); this.loaded = []; this.destroyed = false; this.reloads = 0; this.session = { setPermissionRequestHandler: fn => { this.permission = fn; }, setPermissionCheckHandler: fn => { this.check = fn; } }; }
    setWindowOpenHandler(fn) { this.open = fn; }
    async loadURL(url) { this.loaded.push(url); }
    reload() { this.reloads++; }
    close() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  class View {
    constructor(options) { this.options = options; this.webContents = new Contents(); views.push(this); }
    setBounds(bounds) { this.bounds = bounds; }
  }
  const win = { destroyed: false, zoom: 1, isDestroyed() { return this.destroyed; }, getContentSize: () => [1440, 900], webContents: { getZoomFactor: () => win.zoom }, contentView: { addChildView: view => attached.add(view), removeChildView: view => attached.delete(view) } };
  const host = createWebAIHost({ View, getWindow: () => win, shell: { openExternal: async url => opened.push(url) } });
  return { host, win, views, attached, opened, Contents };
}
const layout = provider => ({ provider, visible: true, bounds: { x: 270, y: 300, width: 800, height: 500 } });
test('only known providers and HTTPS pages are allowed; lookalike domains are not official', () => {
  assert.equal(WEB_AI_PROVIDERS.length, 2);
  assert.throws(() => webAIProvider('https://example.com'), /请选择/);
  for (const url of ['file:///C:/private', 'javascript:alert(1)', 'http://localhost', 'data:text/html,x', 'https://user:password@example.com']) assert.equal(isSecureWebURL(url), false);
  assert.equal(isWebAIPage('deepseek', 'https://chat.deepseek.com/'), true);
  assert.equal(isWebAIPage('deepseek', 'https://deepseek.com.evil.test/'), false);
  assert.equal(isWebAIPage('doubao', 'https://www.doubao.com/chat/'), true);
  assert.equal(isWebAIPage('doubao', 'https://chat.deepseek.com/'), false);
});
test('native view stays within viewport, scroll region and expanded rail at non-default zoom', () => {
  assert.deepEqual(fitWebAIBounds({ x: -20, y: 80, width: 500, height: 900 }, [600, 500], 1.25), { x: 0, y: 100, width: 600, height: 400 });
  assert.deepEqual(fitWebAIBounds({ x: 1000, y: 1000, width: 200, height: 100 }, [600, 500]), { x: 600, y: 500, width: 0, height: 0 });
  assert.throws(() => fitWebAIBounds({ x: NaN }, [600, 500]), /无效/);
  assert.throws(() => fitWebAIBounds(layout('deepseek').bounds, [600, Infinity]), /无效/);
  assert.deepEqual(clipWebAISlot({ left: 250, top: -100, right: 1430, bottom: 1000 }, { left: 0, top: 0, right: 1440, bottom: 900 }, { left: 240, top: 40, right: 1440, bottom: 864 }, 310), { x: 252, y: 40, width: 878, height: 824 });
});
test('webviews create lazily, keep independent login partitions and reuse contents across tabs', () => {
  const f = fixture(); f.host.layout({ visible: false }); assert.equal(f.views.length, 0);
  f.host.layout({ ...layout('deepseek'), bounds: { x: 0, y: 0, width: 20, height: 20 } }); assert.equal(f.views.length, 0);
  f.host.layout(layout('deepseek')); f.host.layout(layout('deepseek'));
  assert.equal(f.views.length, 1); assert.equal(f.attached.size, 1);
  f.host.layout(layout('doubao'));
  assert.equal(f.views.length, 2); assert.deepEqual([...f.attached], [f.views[1]]);
  for (let n = 0; n < 2; n++) {
    const view = f.views[n], prefs = view.options.webPreferences;
    assert.deepEqual(view.webContents.loaded, [WEB_AI_PROVIDERS[n].url]);
    assert.equal(prefs.partition, 'persist:xm-official-ai-' + WEB_AI_PROVIDERS[n].id);
    assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.webSecurity, true); assert.equal(prefs.devTools, false); assert.equal(prefs.preload, undefined);
    let permitted; view.webContents.permission(null, 'media', value => { permitted = value; }); assert.equal(permitted, false);
    assert.equal(view.webContents.check(null, 'clipboard-read'), false);
  }
  f.host.layout({ visible: false }); assert.equal(f.attached.size, 0);
  assert.equal(f.views[1].webContents.isDestroyed(), false);
  f.host.layout(layout('deepseek')); assert.equal(f.views.length, 2); assert.equal(f.views[0].webContents.loaded.length, 1);
  f.host.dispose(); assert.equal(f.attached.size, 0); assert(f.views.every(v => v.webContents.isDestroyed()));
  assert.throws(() => f.host.action('deepseek', 'reload'), /已关闭/);
  f.host.dispose();
});
test('popups inherit isolation, dangerous navigation is prevented, and disposal closes popups', () => {
  const f = fixture(); f.host.layout(layout('deepseek')); const wc = f.views[0].webContents;
  assert.equal(wc.open({ url: 'file:///C:/secret' }).action, 'deny');
  const allowed = wc.open({ url: 'https://accounts.example.com/login' });
  assert.equal(allowed.action, 'allow'); assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.partition, 'persist:xm-official-ai-deepseek');
  assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.nodeIntegration, false); assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.preload, undefined);
  for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
    let blocked = false; wc.emit(event, { preventDefault() { blocked = true; } }, 'file:///C:/secret'); assert.equal(blocked, true);
  }
  const popup = new EventEmitter(); popup.webContents = new f.Contents(); popup.isDestroyed = () => !!popup.destroyed; popup.destroy = () => { popup.destroyed = true; popup.emit('closed'); };
  wc.emit('did-create-window', popup);
  assert.equal(popup.webContents.open({ url: 'javascript:alert(1)' }).action, 'deny');
  f.host.dispose(); assert.equal(popup.destroyed, true);
});
test('load failures are visible, reload can recover, and external opens use fixed official URLs', async () => {
  const f = fixture(); await f.host.action('doubao', 'external'); assert.deepEqual(f.opened, ['https://www.doubao.com/chat/']); assert.equal(f.views.length, 0);
  assert.throws(() => f.host.action('doubao', 'https://arbitrary.test/'), /未知/);
  f.host.layout(layout('deepseek')); const wc = f.views[0].webContents;
  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', '', true);
  assert.match(f.host.action('deepseek', 'status').error, /ERR_NAME/);
  f.host.action('deepseek', 'reload'); assert.equal(wc.reloads, 1);
  wc.emit('did-start-loading'); assert.equal(f.host.action('deepseek', 'status').error, '');
  wc.emit('did-stop-loading'); assert.equal(f.host.action('deepseek', 'status').loading, false);
  wc.emit('did-navigate', {}, 'https://accounts.example.com/login'); assert.equal(f.host.action('deepseek', 'status').official, false);
  f.win.destroyed = true; f.host.dispose();
});

const draft = { script: '△ 雨夜追逐\n[EN] JACK: Run, now...\n△ 第二天重逢\n[ES] MIA: Hola, señor.', customKeywords: '悬疑,钢琴', durationSeconds: 60, segmentCount: 3, geminiKey: 'do-not-export', sunoKey: 'do-not-export', apiKey: 'do-not-export' };
const taskData = prompt => { const normalized = prompt.replace(/\r\n/g, '\n'); return JSON.parse(normalized.slice(normalized.lastIndexOf('\n\n') + 2)); };
test('manual web prompts preserve full script and user options without exporting credentials', () => {
  for (const purpose of ['keywords', 'suno']) for (const segmented of [false, true]) {
    const prompt = webAIScriptPrompt({ ...draft, segmented }, purpose), data = taskData(prompt);
    assert.equal(data.originalScript, draft.script); assert.doesNotMatch(prompt, /do-not-export/);
    if (segmented) { assert.equal(data.maxSegments, 3); assert.equal(data.numberedScript.length, 4); assert.match(prompt, /startLine/); }
    if (purpose === 'suno') assert.match(prompt, /no vocals/);
    if (purpose === 'keywords') assert(data.customKeywords.includes('钢琴'));
  }
  assert.throws(() => webAIScriptPrompt({ script: '' }, 'keywords'), /粘贴剧本/);
  assert.throws(() => webAIScriptPrompt(draft, 'other'), /未知/);
});
test('web task copy remains complete and valid JSON with subtitle protection enabled', async () => {
  let value = '', tick;
  const guard = createPunctuationClipboard({ clipboard: { readText: () => value, writeText: text => { value = text; } }, schedule: fn => { tick = fn; return 1; }, cancel: () => {} });
  guard.configure(true, 'compatible');
  const prompt = webAIScriptPrompt({ ...draft, segmented: true }, 'suno');
  const result = await guard.copyPlain(prompt); tick(); tick();
  assert.equal(result.copyVerified, true); assert.equal(value.replace(/\r\n/g, '\n'), prompt); assert.equal(taskData(value).originalScript, draft.script);
  await guard.copy('Subtitles, keep.'); assert.equal(value, 'Subtitles‚ keep․');
  await assert.rejects(guard.copyPlain('Bad\0text'), /格式无效/);
  guard.dispose();
});

const saved = new Map([['black-obsidian.script-draft.v1', JSON.stringify(draft)]]);
globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
let slots = [], cursor = 0, effects = [];
globalThis.i = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], value => { slots[at] = value; }]; },
  useRef(initial) { const at = cursor++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; },
  useEffect: fn => effects.push(fn), useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
};
const compiled = await build({ entryPoints: ['app/src/WebAIStudio.jsx'], bundle: true, write: false, format: 'esm', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment' });
const { WebAIStudio } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)];
const textOf = tree => typeof tree === 'string' ? tree : (tree?.children || []).flat(Infinity).map(textOf).join('');
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && textOf(node) === label);
const render = (active = true) => { cursor = 0; effects = []; return WebAIStudio({ active, onNavigate: () => {} }); };
test('web UI selects and remembers provider, only copies on click, and reports copy failure', async () => {
  const copies = []; globalThis.blackObsidian = { layoutWebAI: async () => {}, webAIAction: async () => {}, copyWebAITask: async (...args) => { copies.push(args); } };
  slots = []; let tree = render(); assert.equal(copies.length, 0);
  assert.match(textOf(tree), /无需 API 密钥/); assert.match(textOf(tree), /自行粘贴/);
  assert.equal(nodes(tree).filter(node => node.type === 'iframe' || node.type === 'webview').length, 0);
  button(tree, '豆包').props.onClick(); tree = render();
  assert.equal(button(tree, '豆包').props['aria-pressed'], true); assert.equal(saved.get('xm.web-ai.provider'), 'doubao');
  await button(tree, '复制 Suno 提示词任务').props.onClick();
  assert.equal(copies[0][0].script, draft.script); assert.equal(copies[0][1], 'suno'); assert.match(textOf(render()), /已完整复制/);
  globalThis.blackObsidian.copyWebAITask = async () => { throw new Error('clipboard busy'); };
  await button(tree, '复制剧本关键词任务').props.onClick(); assert.match(textOf(render()), /clipboard busy/); assert.doesNotMatch(textOf(render()), /已完整复制/);
  assert.equal(render(false).props.hidden, true);
});
test('UI lifecycle hides native page behind dialogs and on page switch, with no observers left', async () => {
  const originals = Object.fromEntries(['setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'window', 'document', 'ResizeObserver', 'MutationObserver'].map(key => [key, globalThis[key]]));
  const layouts = [], frames = new Map(), observers = [], listeners = new Set(), intervals = new Set(); let next = 0, modal = false;
  try {
    globalThis.requestAnimationFrame = fn => { const id = ++next; frames.set(id, fn); return id; }; globalThis.cancelAnimationFrame = id => frames.delete(id);
    globalThis.setInterval = fn => { intervals.add(fn); return fn; }; globalThis.clearInterval = fn => intervals.delete(fn);
    const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
    globalThis.window = { innerWidth: 1440, innerHeight: 900, addEventListener: name => listeners.add(name), removeEventListener: name => listeners.delete(name) };
    globalThis.document = { body: {}, querySelector: () => null, querySelectorAll: () => modal ? [{ getClientRects: () => [1], closest: () => null }] : [] };
    globalThis.ResizeObserver = globalThis.MutationObserver = class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } };
    globalThis.blackObsidian = { layoutWebAI: async input => { layouts.push(input); return null; }, webAIAction: async () => ({ official: true }) };
    slots = []; const tree = render(); const slot = nodes(tree).find(node => node.props.ref);
    slot.props.ref.current = { getBoundingClientRect: () => ({ left: 270, top: 300, right: 1100, bottom: 950 }), closest: () => ({ getBoundingClientRect: () => ({ left: 260, top: 0, right: 1120, bottom: 864 }) }) };
    const cleanup = effects[0](); flush(); assert.equal(layouts.at(-1).visible, true); assert.equal(layouts.at(-1).bounds.height, 562);
    modal = true; observers[1].fn(); flush(); assert.equal(layouts.at(-1).visible, false);
    modal = false; observers[1].fn(); flush(); assert.equal(layouts.at(-1).visible, true);
    cleanup(); assert.equal(layouts.at(-1).visible, false); assert(observers.every(o => o.disconnected)); assert.equal(intervals.size, 0); assert.equal(listeners.size, 0); assert.equal(frames.size, 0);
    render(false); effects[0](); assert.equal(layouts.at(-1).visible, false);
    await Promise.resolve();
  } finally { for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});
test('an older initial snapshot cannot close a newly started analysis overlay', async () => {
  const originalWindow = globalThis.window;
  let receive, finish, removed = false;
  const listeners = new Map();
  globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  globalThis.blackObsidian = {
    layoutWebAI: async () => {}, webAIAction: async () => {},
    onWebAnalysisTask: callback => { receive = callback; return () => { removed = true; }; },
    getWebAnalysisTask: () => new Promise(resolve => { finish = resolve; }),
  };
  let cleanup;
  try {
    slots = []; render(false); cleanup = effects[1]();
    const task = { id: 'request-123', token: 'step-one', provider: 'doubao', stage: '分析剧本', message: '请登录' };
    receive(task); finish(null); await Promise.resolve();
    let tree = render(false);
    assert.equal(tree.props.hidden, false); assert.match(textOf(tree), /豆包 · 分析剧本/);
    nodes(tree).find(node => node.props['aria-label'] === '网页分析结果').props.onChange({ target: { value: 'my in-progress JSON' } });
    receive({ ...task, message: '继续等待' }); tree = render(false);
    assert.equal(nodes(tree).find(node => node.props['aria-label'] === '网页分析结果').props.value, 'my in-progress JSON');
    receive(null); assert.equal(render(false).props.hidden, true);
  } finally {
    cleanup?.(); assert.equal(removed, true); assert.equal(listeners.size, 0);
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  }
});
