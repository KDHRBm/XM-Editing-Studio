import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createScanProgress, scanCardBounds } from '../app/electron/jianying-scan-progress.mjs';
import { createJianyingHost } from '../app/electron/jianying-host.mjs';
import { DEEPSEEK_SCAN } from '../app/shared/jianying-models.mjs';

function cardFixture(t, delay = async () => {}) {
  const windows = [], notifications = [], handlers = new Map();
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.destroyed = false; this.visible = false; this.shows = 0; this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.send = (_name, value) => { this.sent = value; }; this.webContents.setWindowOpenHandler = callback => { this.openHandler = callback; }; windows.push(this); }
    isDestroyed() { return this.destroyed; }
    setBounds(bounds) { this.bounds = bounds; }
    setContentProtection(value) { this.protected = value; }
    setIgnoreMouseEvents(value) { this.passthrough = value; }
    async loadFile(file) { this.webContents.mainFrame.url = pathToFileURL(file).href; }
    showInactive() { this.visible = true; this.shows++; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() { this.shown = true; }
    close() { this.closed = true; }
  }
  const screen = new EventEmitter();
  screen.getDisplayMatching = screen.getPrimaryDisplay = () => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1040 } });
  screen.screenToDipPoint = point => point;
  const main = { restored: 0, shown: 0, focused: 0, isDestroyed: () => false, isMinimized: () => true, getBounds: () => ({ x: -1800, y: 0, width: 1000, height: 800 }), restore() { this.restored++; }, show() { this.shown++; }, focus() { this.focused++; } };
  let stops = 0;
  const card = createScanProgress({ Window, screen, ipcMain: { handle: (name, callback) => handlers.set(name, callback), removeHandler: name => handlers.delete(name) }, Notification, appDirectory: path.resolve('app'), getMainWindow: () => main, cancelScan: async () => { stops++; }, delay });
  t.after(() => card.dispose());
  const action = name => { const window = windows.at(-1); return handlers.get('bos:scan-card-action')({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, name); };
  const update = (stage, id = 'scan-1', extra = {}) => card.update({ id, stage, message: 'fixture', ...extra });
  return { card, windows, notifications, handlers, main, screen, action, update, stops: () => stops };
}

test('scan card stays in the work area of the main monitor without stealing focus', t => {
  assert.deepEqual(scanCardBounds({ x: -1920, y: 0, width: 1920, height: 1040 }), { x: -378, y: 792, width: 366, height: 236 });
  const f = cardFixture(t); f.update('preparing'); const window = f.windows[0];
  assert.equal(window.visible, false); window.emit('ready-to-show');
  assert.equal(window.visible, true); assert.equal(window.options.parent, undefined); assert.equal(window.options.skipTaskbar, true);
  assert.equal(window.protected, true); assert.equal(f.main.focused, 0);
  f.screen.emit('display-metrics-changed'); assert.equal(window.bounds.x, -378);
  assert.equal(window.options.webPreferences.nodeIntegration, false); assert.equal(window.openHandler().action, 'deny');
});

test('scan card is hidden before capture even if it finishes loading during the capture handshake', async t => {
  let release; const f = cardFixture(t, () => new Promise(resolve => { release = resolve; }));
  f.update('preparing'); const window = f.windows[0];
  const pending = f.card.beforeCapture('scan-1'); window.emit('ready-to-show');
  assert.equal(window.visible, false); release(); await pending;
  assert.equal(window.visible, false);
  f.update('analyzing'); assert.equal(window.visible, true);
  await assert.rejects(f.card.beforeCapture('wrong-id'), /结束/);
});

test('completion reopens a dismissed card, notifies once, and restores main on view results', async t => {
  const f = cardFixture(t); f.update('preparing'); const window = f.windows[0]; window.emit('ready-to-show');
  await assert.rejects(f.action('open'), /不支持/); assert.equal(f.main.focused, 0);
  await f.action('dismiss'); f.update('analyzing'); assert.equal(window.visible, false);
  f.update('complete', 'scan-1', { count: 3, message: '已识别 3 个草稿' });
  assert.equal(window.visible, true); assert.equal(f.notifications.length, 1); assert.match(f.notifications[0].options.body, /3/);
  f.update('complete'); assert.equal(f.notifications.length, 1);
  await f.action('open'); assert.equal(window.visible, false); assert.equal(f.main.restored, 1); assert.equal(f.main.focused, 1);
  f.update('preparing', 'scan-2'); assert.equal(window.visible, true); assert.equal(window.sent.finishedAt, undefined);
  f.update('complete', 'scan-2'); f.notifications[1].emit('click'); assert.equal(f.main.focused, 2);
});

test('stop and failure remain visible, terminal commands and foreign IPC are rejected, disposal closes the card', async t => {
  const f = cardFixture(t); f.update('preparing'); const window = f.windows[0]; window.emit('ready-to-show');
  await f.action('stop'); assert.equal(f.stops(), 1);
  f.update('cancelled'); assert.equal(window.visible, true); assert.equal(f.notifications.length, 0);
  await assert.rejects(f.action('stop'), /不支持/);
  assert.throws(() => f.handlers.get('bos:scan-card-state')({ sender: {} }), /无效/);
  await assert.rejects(f.handlers.get('bos:scan-card-action')({ sender: window.webContents, senderFrame: { url: window.webContents.mainFrame.url } }, 'stop'), /无效/);
  f.update('preparing', 'scan-2'); f.update('error', 'scan-2'); assert.equal(f.notifications.length, 1);
  f.card.dispose(); assert.equal(window.destroyed, true); assert.equal(f.handlers.size, 0); assert.equal(f.screen.listenerCount('display-removed'), 0);
  f.update('preparing', 'scan-3'); assert.equal(f.windows.length, 1);
});

test('export progress does not cover recognition targets and stays click-through until it ends', async t => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const preferred = scanCardBounds(area, [], 260);
  const point = { x: preferred.x + 40, y: preferred.y + 30 };
  const moved = scanCardBounds(area, [point], 260);
  assert.ok(point.y > moved.y + moved.height + 80 || point.x > moved.x + moved.width + 120);
  const f = cardFixture(t);
  f.update('preparing', 'export-1', { operation: 'export', total: 3, completed: 0, current: 0, mode: 'wait_close', avoid: [] });
  const window = f.windows[0]; window.emit('ready-to-show');
  assert.equal(window.bounds.height, 260); assert.equal(window.passthrough, true); assert.equal(window.options.focusable, false);
  f.update('running', 'export-1', { operation: 'export', total: 3, completed: 1, current: 2, mode: 'wait_close', avoid: [] });
  await assert.rejects(f.action('open'), /不支持/); assert.equal(f.main.focused, 0);
  f.update('cancelled', 'export-1', { operation: 'export', total: 3, completed: 1, current: 2, mode: 'wait_close', message: '已按 F10 结束运行，已完成 1/3 个草稿' });
  assert.equal(window.passthrough, false); assert.equal(window.visible, true);
  assert.match(f.notifications[0].options.title, /运行已结束/); assert.match(f.notifications[0].options.body, /F10/);
  await f.action('open'); assert.equal(f.main.focused, 1);
});

test('background submission notifications do not claim rendering finished', t => {
  const f = cardFixture(t);
  f.update('preparing', 'export-1', { operation: 'export', total: 2, completed: 0, current: 0, mode: 'return_home' });
  f.update('complete', 'export-1', { operation: 'export', total: 2, completed: 2, current: 2, mode: 'return_home', message: '已提交 2/2 个草稿，剪映正在后台导出' });
  assert.match(f.notifications[0].options.title, /任务已提交/);
  assert.match(f.notifications[0].options.body, /后台导出/);
});

test('recording card stays passive, hides before sampling and reports F10 cancellation', async t => {
  const f = cardFixture(t);
  const extra = { operation: 'recording', total: 4, completed: 2, current: 3, mode: 'wait_close', step: 'close_btn', skipAvailable: false };
  f.update('preparing', 'record-1', extra); const window = f.windows[0]; window.emit('ready-to-show');
  assert.equal(window.bounds.height, 280); assert.equal(window.passthrough, true);
  await f.card.beforeCapture('record-1'); assert.equal(window.visible, false);
  f.update('recording', 'record-1', extra); assert.equal(window.visible, true);
  await assert.rejects(f.action('open'), /不支持/);
  f.update('retry', 'record-1', { ...extra, message: '请重按 F8' }); assert.equal(window.passthrough, true);
  f.update('cancelled', 'record-1', { ...extra, message: '已按 F10 结束录制，原坐标模板已保留' });
  assert.equal(window.passthrough, false);
  assert.match(f.notifications[0].options.title, /录制已结束/); assert.match(f.notifications[0].options.body, /F10/);
  await f.action('open'); assert.equal(f.main.focused, 1);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
async function hostFixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-scan-host-'));
  const bytes = Buffer.from('fake worker, never executed');
  await fs.mkdir(path.join(root, 'build/jianying'), { recursive: true });
  await fs.writeFile(path.join(root, 'build/jianying/JianYingEngine.exe'), bytes);
  await fs.writeFile(path.join(root, 'build/jianying/engine.json'), JSON.stringify({ sha256: createHash('sha256').update(bytes).digest('hex') }));
  const children = [], commands = [], progress = [], exportEvents = [], recordingEvents = []; let minimized = 0;
  const spawnProcess = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough();
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const value = JSON.parse(chunk.toString()); commands.push(value);
      queueMicrotask(() => child.stdout.write(JSON.stringify({ id: value.id, state: { busy: false, recording: false, modal: null } }) + '\n')); done();
    } });
    children.push(child); return child;
  };
  const host = createJianyingHost({ appDirectory: root, dataDirectory: path.join(root, 'data'), spawnProcess, onScanProgress: value => progress.push(value), onExportProgress: value => exportEvents.push(value), onRecordingProgress: value => recordingEvents.push(value), minimize: () => { minimized++; }, ...overrides });
  t.after(async () => { await host.dispose(); for (const child of children) child.stdout.end(); await fs.rm(root, { recursive: true, force: true }); });
  const emit = value => children.at(-1).stdout.write(JSON.stringify(value) + '\n');
  await host.run('scan', {}, { provider: { protocol: 'gemini', baseUrl: 'https://example.invalid/v1beta', apiKey: 'test' }, model: 'gemini-test' });
  return { host, children, commands, progress, exportEvents, recordingEvents, emit, minimized: () => minimized };
}

test('DeepSeek scan routes screenshots through official web and preserves Gemini rename connection', async t => {
  const webCalls = [], apiCalls = []; let closed = 0;
  const f = await hostFixture(t, { webScan: { request: async (input, signal, report) => { webCalls.push({ input, signal }); report('DeepSeek 正在扫描'); return '{"drafts":[]}'; }, close: () => { closed++; }, dispose() {} }, requestAI: async (...args) => { apiCalls.push(args); return '[]'; } });
  await f.host.run('scan', {}, DEEPSEEK_SCAN);
  assert.equal(f.commands.at(-1).args.webScan, true);
  f.emit({ event: 'scan-progress', id: 'web-1', stage: 'preparing', message: '准备' });
  f.emit({ event: 'ai', token: 'image-1', prompt: 'find', image: 'YWJj' }); await tick();
  assert.equal(webCalls.length, 1); assert.equal(apiCalls.length, 0);
  assert.equal(f.commands.find(c => c.action === 'ai_result').args.text, '{"drafts":[]}');
  await assert.rejects(f.host.run('preview', { ai: true }, DEEPSEEK_SCAN), /仅用于草稿扫描/);
  await f.host.run('stop'); assert.ok(webCalls[0].signal.aborted); assert.ok(closed);
  await f.host.run('preview', { ai: true }, { provider: { protocol: 'gemini', apiKey: 'test', baseUrl: 'https://example.invalid/v1beta' }, model: 'gemini-test' });
  f.emit({ event: 'ai', token: 'rename-1', prompt: 'rename' }); await tick();
  assert.equal(apiCalls.length, 1);
});

test('recording capture acknowledges the same sample token only after the overlay is hidden', async t => {
  let release; const f = await hostFixture(t, { beforeScanCapture: () => new Promise(resolve => { release = resolve; }) });
  const event = { event: 'recording-progress', id: 'record-1', mode: 'return_home', total: 3, current: 1, completed: 0, step: 'export', skipAvailable: false, message: 'F8' };
  f.emit({ ...event, stage: 'preparing' });
  f.emit({ event: 'recording-capture', id: 'record-1', token: 'sample-1' });
  assert.equal(f.commands.some(value => value.action === 'recording_capture_ready'), false);
  release(); await tick();
  assert.deepEqual(f.commands.find(value => value.action === 'recording_capture_ready').args, { id: 'record-1', token: 'sample-1', error: '' });
  await assert.rejects(f.host.run('recording_capture_ready', { id: 'record-1' }), /无效/);
  f.emit({ ...event, stage: 'recording', current: 2, completed: 1 });
  f.emit({ ...event, stage: 'retry', current: 2, completed: 1 });
  f.emit({ ...event, stage: 'complete', current: 3, completed: 3 });
  f.emit({ ...event, stage: 'recording', current: 2, completed: 1 });
  assert.deepEqual(f.recordingEvents.map(value => value.stage), ['preparing','recording','retry','complete']);
});

test('recording rejects impossible counts, reports capture failure and becomes terminal on worker exit', async t => {
  const f = await hostFixture(t, { beforeScanCapture: async () => { throw new Error('hidden failed'); } });
  const event = { event: 'recording-progress', id: 'record-1', stage: 'preparing', mode: 'wait_close', total: 4, current: 1, completed: 0, step: 'export', skipAvailable: false, message: 'F8' };
  f.emit(event); f.emit({ ...event, stage: 'recording', total: 3 });
  assert.equal(f.recordingEvents.length, 1);
  f.emit({ event: 'recording-capture', id: 'record-1', token: 'sample-1' }); await tick();
  assert.match(f.commands.find(value => value.action === 'recording_capture_ready').args.error, /F8/);
  f.children[0].emit('exit', 1);
  assert.equal(f.recordingEvents.at(-1).stage, 'error'); assert.equal(f.recordingEvents.at(-1).operation, 'recording');
});

test('export worker events preserve counts, reject invalid data and ignore late running events after F10', async t => {
  const f = await hostFixture(t);
  const event = { event: 'export-progress', id: 'export-1', total: 3, completed: 0, current: 0, mode: 'wait_close', message: 'fixture', draftName: '', avoid: [[100,200], [NaN,20], ['a',1]] };
  f.emit({ ...event, stage: 'preparing' });
  f.emit({ ...event, stage: 'running', total: -1 });
  f.emit({ ...event, stage: 'running', id: 'stale' });
  f.emit({ ...event, stage: 'running', current: 2, completed: 1, draftName: '第2集' });
  f.emit({ ...event, stage: 'stopping', current: 2, completed: 1 });
  f.emit({ ...event, stage: 'cancelled', current: 2, completed: 1, message: '已按 F10 结束运行' });
  f.emit({ ...event, stage: 'running' });
  assert.deepEqual(f.exportEvents.map(value => value.stage), ['preparing', 'running', 'stopping', 'cancelled']);
  assert.deepEqual(f.exportEvents[0].avoid, [[100,200]]);
  assert.equal(f.exportEvents[1].draftName, '第2集');
  assert.equal(f.exportEvents.at(-1).completed, 1);
});

test('unexpected worker exit turns an active export card into an error card', async t => {
  const f = await hostFixture(t);
  f.emit({ event: 'export-progress', id: 'export-1', stage: 'preparing', total: 2, completed: 0, current: 0, mode: 'return_home', message: 'fixture' });
  f.children[0].emit('exit', 1);
  assert.equal(f.exportEvents.at(-1).stage, 'error');
  assert.equal(f.exportEvents.at(-1).operation, 'export');
});

test('worker handshake waits for the overlay to hide and internal ack is not renderer accessible', async t => {
  let release; const f = await hostFixture(t, { beforeScanCapture: () => new Promise(resolve => { release = resolve; }) });
  f.emit({ event: 'minimize' }); f.emit({ event: 'scan-progress', id: 'a', stage: 'preparing', message: '准备' });
  f.emit({ event: 'scan-capture', id: 'a' });
  assert.equal(f.minimized(), 1); assert.equal(f.commands.some(c => c.action === 'scan_capture_ready'), false);
  release(); await tick();
  assert.deepEqual(f.commands.find(c => c.action === 'scan_capture_ready').args, { id: 'a', error: '' });
  await assert.rejects(f.host.run('scan_capture_ready', { id: 'a' }), /无效/);
  f.emit({ event: 'scan-progress', id: 'a', stage: 'locating', message: '定位草稿分区' });
  f.emit({ event: 'scan-progress', id: 'wrong', stage: 'complete', message: 'wrong' });
  f.emit({ event: 'scan-progress', id: 'a', stage: 'complete', message: '完成', count: 2 });
  f.emit({ event: 'scan-progress', id: 'a', stage: 'analyzing', message: 'stale' });
  assert.deepEqual(f.progress.map(p => p.stage), ['preparing', 'locating', 'complete']);
});

test('hide failure is acknowledged to the worker and unexpected exit ends progress', async t => {
  const f = await hostFixture(t, { beforeScanCapture: async () => { throw new Error('unavailable'); } });
  f.emit({ event: 'scan-progress', id: 'a', stage: 'preparing', message: '准备' }); f.emit({ event: 'scan-capture', id: 'a' }); await tick();
  assert.match(f.commands.find(c => c.action === 'scan_capture_ready').args.error, /隐藏/);
  f.children[0].emit('exit', 1); assert.equal(f.progress.at(-1).stage, 'error');
  await f.host.run('status');
  f.emit({ event: 'scan-progress', id: 'b', stage: 'preparing', message: '准备' });
  f.children[0].emit('error', new Error('late')); assert.equal(f.progress.at(-1).id, 'b'); assert.equal(f.progress.at(-1).stage, 'preparing');
});

test('stop aborts the in-flight model request and a cancelled scan ignores late completion', async t => {
  let signal;
  const f = await hostFixture(t, { requestAI: async (_connection, _input, value) => {
    signal = value; return new Promise((_resolve, reject) => value.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } });
  f.emit({ event: 'scan-progress', id: 'a', stage: 'preparing', message: '准备' });
  f.emit({ event: 'scan-progress', id: 'a', stage: 'analyzing', message: '识别' });
  f.emit({ event: 'ai', token: 'token', prompt: 'test' }); assert.equal(signal.aborted, false);
  await f.host.run('stop'); await tick(); assert.equal(signal.aborted, true);
  assert.equal(f.commands.find(c => c.action === 'ai_result').args.error, 'cancelled');
  f.emit({ event: 'scan-progress', id: 'a', stage: 'cancelled', message: '中断' });
  f.emit({ event: 'scan-progress', id: 'a', stage: 'complete', message: 'late' });
  assert.equal(f.progress.at(-1).stage, 'cancelled');
});

test('Gemini retry messages reach the scan card and cannot overwrite a stopped or newer task', async t => {
  let report, finish;
  const f = await hostFixture(t, { requestAI: async (_connection, _input, _signal, _fetcher, options) => {
    report = options.onRetry;
    return new Promise(resolve => { finish = resolve; });
  } });
  f.emit({ event: 'scan-progress', id: 'retry-1', stage: 'preparing', message: '准备' });
  f.emit({ event: 'scan-progress', id: 'retry-1', stage: 'locating', message: '定位' });
  f.emit({ event: 'ai', token: 'retry-token', prompt: 'test' });
  report('Gemini 正在重试（2/3）');
  assert.equal(f.progress.at(-1).message, 'Gemini 正在重试（2/3）');
  await f.host.run('stop');
  report('late retry'); assert.notEqual(f.progress.at(-1).message, 'late retry');
  f.emit({ event: 'scan-progress', id: 'retry-2', stage: 'preparing', message: '新任务' });
  report('old retry'); assert.equal(f.progress.at(-1).message, '新任务');
  finish('{}'); await tick();
});
