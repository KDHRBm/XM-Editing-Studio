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
