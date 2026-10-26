import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { independentAnalysisModels, newProject, clearCurrentProject } from '../app/shared/script-projects.mjs';
import { WEB_ANALYZERS } from '../app/shared/script-analyzers.mjs';

const [deepseek, doubao] = WEB_ANALYZERS;
const geminiKey = 'g::gemini-test';
const script = '[EN] A: Welcome home.';
test('legacy models migrate once; new, cleared and explicitly blank drafts retain independent choices', () => {
  const legacy = independentAnalysisModels({ geminiKey: deepseek.key });
  assert.equal(legacy.libraryGeminiKey, deepseek.key);
  assert.equal(independentAnalysisModels({ ...legacy, geminiKey }).libraryGeminiKey, deepseek.key);
  assert.equal(independentAnalysisModels({ geminiKey, libraryGeminiKey: '' }).libraryGeminiKey, '');
  const project = newProject({ script, geminiKey, libraryGeminiKey: doubao.key });
  const cleared = clearCurrentProject({ projects: [project], activeId: project.id, history: [] }).projects[0];
  assert.equal(cleared.draft.geminiKey, geminiKey);
  assert.equal(cleared.draft.libraryGeminiKey, doubao.key);
});

const saved = new Map([['xiaoma.script-projects.v1', JSON.stringify({
  activeId: 'legacy', projects: [{ id: 'legacy', draft: { script, geminiKey: deepseek.key }, recommendation: null }],
  history: [{ id: 'old-history', draft: { script: '[EN] B: Yesterday.', geminiKey: doubao.key }, recommendation: null }],
})]]);
globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
globalThis.i = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: value => ({ current: value }), useEffect: () => {}, useMemo: fn => fn(),
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
};
const bundle = await build({ stdin: { contents: "export {ScriptAutomation} from '../app/src/ScriptAutomation.jsx'; export {useScriptProjects} from '../app/src/ScriptProjects.jsx';", resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') }, bundle: true, write: false, format: 'esm', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment' });
const load = suffix => import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + '\n//' + suffix).toString('base64'));
const ui = await load('first');
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)];
const textOf = tree => typeof tree === 'string' ? tree : (tree?.children || []).flat(Infinity).map(textOf).join('');
const find = (tree, label) => nodes(tree).find(node => node.props['aria-label'] === label);
const providers = [{ id: 'g', protocol: 'gemini', name: 'Gemini', models: ['gemini-test'], apiKey: 'fixture' }, { id: 's', protocol: 'suno', name: 'Suno', models: ['suno-test'], apiKey: 'fixture' }];
const captured = {};
const queue = { add: (...args) => { captured.queue = args; return 'job'; }, addSegment: (...args) => { captured.segment = args; return 'segment-job'; }, startOnly: () => {}, start: () => {} };
const render = () => ui.ScriptAutomation({ providers, automation: { queue, running: false, jobs: [] }, onNavigate: () => {} });
const library = tree => nodes(tree).find(n => n.props.settings && n.props.onAnalysis);

test('both selectors change independently and their selections survive storage reload and script switching', async () => {
  let tree = render();
  assert.equal(find(tree, '剧本分析模型').props.value, deepseek.key);
  assert.equal(find(library(tree).props.settings, '本地匹配分析模型').props.value, deepseek.key);
  find(tree, '剧本分析模型').props.onChange({ target: { value: geminiKey } });
  tree = render();
  assert.equal(find(library(tree).props.settings, '本地匹配分析模型').props.value, deepseek.key);
  find(library(tree).props.settings, '本地匹配分析模型').props.onChange({ target: { value: doubao.key } });
  tree = render();
  assert.equal(find(tree, '剧本分析模型').props.value, geminiKey);
  assert.equal(library(tree).props.gemini.key, doubao.key);
  assert.equal(library(tree).props.generationAnalyzer.key, geminiKey);
  const persisted = JSON.parse(saved.get('xiaoma.script-projects.v1'));
  assert.equal(persisted.projects[0].draft.libraryGeminiKey, doubao.key);
  assert.equal(persisted.history[0].draft.libraryGeminiKey, doubao.key);
  const reloaded = await load('reload');
  assert.equal(reloaded.useScriptProjects().project.draft.geminiKey, geminiKey);
  assert.equal(reloaded.useScriptProjects().project.draft.libraryGeminiKey, doubao.key);
  ui.useScriptProjects().add();
  ui.useScriptProjects().change({ geminiKey: deepseek.key, libraryGeminiKey: geminiKey });
  ui.useScriptProjects().select('legacy');
  assert.equal(find(render(), '剧本分析模型').props.value, geminiKey);
  assert.equal(library(render()).props.gemini.key, doubao.key);
});

test('local analysis uses its own selected web model while segment and whole Suno planning use the generation model', async () => {
  const oldApi = globalThis.blackObsidian;
  const requests = [];
  globalThis.blackObsidian = { analyzeWebScript: async request => { requests.push(request); return { analysis: { summary: '温暖重逢', keywords: ['温暖'] }, matches: [], total: 0, evaluated: 0 }; } };
  try {
    let tree = render(), node = library(tree);
    const panel = node.type(node.props);
    const analyze = nodes(panel).find(n => n.type === 'button' && textOf(n) === '豆包 识别剧本关键词并匹配');
    await analyze.props.onClick();
    assert.equal(requests.length, 1); assert.equal(requests[0].provider, 'doubao');
    assert.equal(requests[0].purpose, 'library-match');
    assert.equal(ui.useScriptProjects().project.recommendation.libraryGeminiKey, doubao.key);
    assert.equal(ui.useScriptProjects().project.draft.geminiKey, geminiKey);
    node.props.onGenerate({ id: 'segment-1', title: '重逢', startLine: 1, endLine: 1, summary: '重逢', keywords: ['温暖'] });
    assert.equal(captured.segment[3].key, geminiKey);
    tree = render();
    await nodes(tree).find(n => n.type === 'button' && textOf(n) === '加入队列').props.onClick();
    assert.equal(captured.queue[1].key, geminiKey);
    assert.equal(captured.queue[0].libraryGeminiKey, doubao.key);
    assert.equal(requests.length, 1, 'queuing must not call either website or Suno');
  } finally { globalThis.blackObsidian = oldApi; }
});
