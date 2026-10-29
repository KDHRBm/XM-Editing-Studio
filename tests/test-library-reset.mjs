import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const saved = new Map();
let injectedCatalog;
globalThis.localStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
globalThis.i = {
  useRef: value => ({ current: value }),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: initial => [injectedCatalog && initial?.tracks ? injectedCatalog : typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {}, useMemo: calculate => calculate(),
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
};
const compile = async file => { const bundle = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment' }); return import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')); };
const { MusicLibrary, clearCurrentLibraryMatch } = await compile('app/src/MusicLibrary.jsx');
const projectsModule = await compile('app/src/ScriptProjects.jsx');
function findButton(tree, label = 'fixture') {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === 'button' && tree.children.flat().some(item => typeof item === 'string' && item.includes(label))) return tree;
  for (const child of (tree.children || []).flat(Infinity)) { const found = findButton(child, label); if (found) return found; }
  return null;
}
const input = { script:'[EN] A: Hello.', title:'test', hint:'' };
test('clearing a project cancels its pending request and ignores a late Gemini response', async () => {
  let finish, signal, remembered = 0;
  globalThis.fetch = (_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); };
  const tree = MusicLibrary({ input, projectId:'cleared-project', lines:[], gemini:{provider:{apiKey:'fixture'},model:'fixture'}, onAnalysis:()=>remembered++ });
  const task = findButton(tree).props.onClick();
  clearCurrentLibraryMatch('cleared-project', input);
  assert.equal(signal.aborted, true);
  finish({ok:true,json:async()=>({analysis:{summary:'late result'},matches:[]})});
  await task;
  assert.equal(remembered, 0);
  assert.equal(saved.has('black-obsidian.library-match.v1'), false);
});

test('custom title results can be selected without Gemini and old recommendations are disabled', async () => {
  injectedCatalog = { directories: [], tracks: [{ id: 'local', title: '悬疑_钢琴', relativePath: '悬疑_钢琴.wav' }], revision: '1' };
  let used, calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected API call'); };
  const old = { ...input, customKeywords: '温暖', value: { analysis: { summary: 'old', keywords: ['温暖'] }, matches: [{ id: 'local', reason: 'old', keywords: ['温暖'] }] } };
  const tree = MusicLibrary({ input: { ...input, customKeywords: '悬疑' }, projectId: 'search', savedRecommendation: old, lines: [], gemini: null, onChange: () => {}, onUse: async (...args) => { used = args; } });
  const select = findButton(tree, '选用此音乐'); assert.equal(select.props.disabled, false); await select.props.onClick();
  assert.equal(used[0].id, 'local'); assert.deepEqual(used[1].keywords, ['悬疑']); assert.match(used[1].summary, /未调用 AI/); assert.equal(calls, 0);
  assert.equal(findButton(tree, '请重新匹配').props.disabled, true);
  injectedCatalog = null;
});

test('late Gemini results stay in history under their captured keywords', async () => {
  const { useScriptProjects } = projectsModule;
  let store = useScriptProjects(); store.change({ ...input, customKeywords: '钢琴' });
  store = useScriptProjects(); const projectId = store.activeId;
  const record = { ...store.project.draft, value: { analysis: { summary: 'old' }, matches: [] } };
  store.change({ customKeywords: '弦乐' }); store.remember(projectId, record);
  store = useScriptProjects();
  assert.equal(store.project.draft.customKeywords, '弦乐'); assert.equal(store.project.recommendation, null);
  assert.equal(store.history[0].draft.customKeywords, '钢琴'); assert.equal(store.history[0].recommendation, record);
  store.restore(store.history[0].id); store = useScriptProjects();
  assert.equal(store.projects.length, 2); assert.equal(store.project.draft.customKeywords, '钢琴');
});
test('clearing a different project leaves the in-flight recommendation intact', async () => {
  let finish, signal, remembered = 0;
  globalThis.fetch = (_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); };
  const tree = MusicLibrary({ input, projectId:'running-project', lines:[], gemini:{provider:{apiKey:'fixture'},model:'fixture'}, onAnalysis:()=>remembered++ });
  const task = findButton(tree).props.onClick();
  clearCurrentLibraryMatch('other-project', {script:'different',hint:''});
  assert.equal(signal.aborted, false);
  finish({ok:true,json:async()=>({analysis:{summary:'kept result'},matches:[]})});
  await task;
  assert.equal(remembered, 1);
});

test('clear history persists an empty list, preserves open scripts and ignores late history writes', async () => {
  const { useScriptProjects } = projectsModule;
  let store = useScriptProjects();
  const before = store.projects, activeId = store.activeId;
  const lateRemember = store.remember;
  const record = { ...store.project.draft, value: { matches: [] } };
  store.clearHistory(); store = useScriptProjects();
  assert.deepEqual(store.history, []); assert.equal(store.projects, before); assert.equal(store.activeId, activeId);
  assert.deepEqual(JSON.parse(saved.get('xiaoma.script-projects.v1')).history, []);
  lateRemember(activeId, record); store = useScriptProjects();
  assert.deepEqual(store.history, []); assert.equal(store.project.recommendation, record);
  store.remember(activeId, record); store = useScriptProjects(); assert.equal(store.history.length, 1, 'new analyses can create new history');
});
