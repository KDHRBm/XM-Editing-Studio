import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
let states = [], cursor = 0, effects = [];
globalThis.i = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState(initial) { const at = cursor++; if (!(at in states)) states[at] = typeof initial === 'function' ? initial() : initial; return [states[at], value => { states[at] = value; }]; },
  useEffect: fn => effects.push(fn), useRef: value => ({ current: value }),
};
const bundle = await build({ entryPoints: ['app/src/LocalModels.jsx'], bundle: true, write: false, format: 'esm', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment' });
const { LocalModels, useLocalProvider } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)] : [];
const textOf = tree => typeof tree === 'string' ? tree : (tree?.children || []).flat(Infinity).map(textOf).join('');

test('a fresh computer can download Qwen without a preinstalled runtime or detected GPU', async () => {
  for (const status of [null, { models: [], runtimeInstalled: false, hardware: null }]) {
    const calls = [];
    globalThis.blackObsidian = { localModelAction: async (...args) => { calls.push(args); return { models: [], runtimeInstalled: false }; } };
    states = [status, null, '', '', null]; cursor = 0; effects = [];
    const tree = LocalModels(), all = nodes(tree);
    const row = all.find(n => n.props.className === 'bos-local-model-row' && textOf(n).includes('qwen3.5:4b'));
    assert.ok(row, 'Qwen must remain visible before device detection completes');
    const download = nodes(row).find(n => n.type === 'button');
    assert.equal(download.props.disabled, false, 'a clean machine must have an actionable Qwen download');
    assert.ok(all.indexOf(row) < all.findIndex(n => n.props.className === 'bos-local-runtime'), 'downloads must precede advanced setup');
    await download.props.onClick();
    assert.deepEqual(calls[0], ['pull', 'qwen3.5:4b']);
  }
});

test('RX 6500 XT exposes Vulkan controls, real GPU status and the 4 GB preset', async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const calls = [];
  const status = { runtimeInstalled: true, running: true, models: ['qwen3.5:4b'], hardware: { gpuName: 'AMD Radeon RX 6500 XT', hasAmd: true, vramGB: 4, ramGB: 15.8 }, acceleration: {
    settings: { mode: 'auto', vulkanDevice: '' }, hasAmd: true, vulkanInstalled: true, rocmInstalled: false, usageState: 'cpu', models: [{ name: 'qwen3.5:4b', vramBytes: 0 }],
  } };
  globalThis.blackObsidian = { localModelAction: async (...args) => { calls.push(args); return status; } };
  states = [status, null, '', '', null]; cursor = 0; effects = [];
  const tree = LocalModels();
  assert.match(textOf(tree), /当前模型仅使用 CPU/);
  assert.match(textOf(tree), /推荐 qwen3.5:4b/);
  const choice = nodes(tree).find(n => n.type === 'select' && n.props.value === 'auto');
  await choice.props.onChange({ target: { value: 'vulkan' } });
  assert.deepEqual(calls[0], ['acceleration', '', { mode: 'vulkan', vulkanDevice: '' }]);
  assert.equal(nodes(choice).find(n => n.type === 'option' && n.props.value === 'rocm').props.disabled, true);
  nodes(tree).find(n => n.type === 'button' && textOf(n).includes('应用 4GB')).props.onClick();
  assert.deepEqual(JSON.parse(values.get('xm-local-model-inference-v1')), { contextTokens: 8192, outputTokens: 2048 });
  const { localAccelerationMessage, localVramText } = await import('../app/src/LocalAccelerationStatus.mjs');
  assert.match(localAccelerationMessage({ usageState: 'idle' }), /尚未加载/);
  assert.match(localAccelerationMessage({ usageState: 'gpu' }), /显卡已参与/);
  assert.match(localAccelerationMessage({ usageState: 'unknown' }), /暂未取得/);
  assert.equal(localVramText({ vramBytes: -1 }), '未知');
  delete globalThis.localStorage;
});
test('local deployment displays downloaded Qwen and adds it without replacing existing connections', async () => {
  const events = [];
  const handlers = new Map();
  globalThis.CustomEvent = class { constructor(type, input) { this.type = type; this.detail = input.detail; } };
  globalThis.window = { dispatchEvent: event => events.push(event), addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) };
  const status = { models: ['qwen3.5:4b'], runtimeInstalled: true, root: 'E:/fixture/local-ai', hardware: { ramGB: 32, vramGB: 8 } };
  globalThis.blackObsidian = { localModelAction: async () => status };
  states = [status, null, '', '', null]; cursor = 0; effects = [];
  const tree = LocalModels();
  assert.match(textOf(tree), /本地千问 \/ DeepSeek/);
  const row = nodes(tree).find(node => node.props.className === 'bos-local-model-row' && textOf(node).includes('qwen3.5:4b'));
  assert.match(textOf(row), /已下载/);
  nodes(row).find(node => node.type === 'button' && textOf(node) === '加入分析模型').props.onClick();
  assert.equal(events[0].detail, 'qwen3.5:4b');
  effects = [];
  let providers = [{ id: 'old', protocol: 'deepseek', models: ['deepseek-flash'], apiKey: 'existing-key' }];
  useLocalProvider(update => { providers = update(providers); });
  const dispose = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(providers[0].apiKey, 'existing-key');
  assert.deepEqual(providers[1].models, ['qwen3.5:4b']);
  assert.equal(providers[1].apiKey, '');
  handlers.get('bos:add-local-provider')({ detail: 'qwen3.5:4b' });
  assert.equal(providers[1].models.length, 1);
  dispose();
});
