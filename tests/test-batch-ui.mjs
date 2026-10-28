import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const saved = new Map([['xiaoma.script-projects.v1', 'workspace-sentinel'], ['black-obsidian.script-draft.v1', 'draft-sentinel']]);
globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
let record, lastRequest, beforeAnalyze;
globalThis.indexedDB = { open: () => {
  const request = {};
  queueMicrotask(() => { request.result = { transaction: () => {
    const transaction = { objectStore: () => ({ get: () => { const result = { result: record }; queueMicrotask(() => transaction.oncomplete()); return result; }, put: value => { record = structuredClone(value); const result = {}; queueMicrotask(() => transaction.oncomplete()); return result; } }) };
    return transaction;
  } }; request.onsuccess(); });
  return request;
} };
let states = [], refs = [], cursor = 0, effects = [], previousEffects = [], mocks = 0;
globalThis.i = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'fragment',
  useState: initial => { const at = cursor++, target = states; if (!(at in target)) target[at] = typeof initial === 'function' ? initial() : initial; return [target[at], value => { target[at] = typeof value === 'function' ? value(target[at]) : value; }]; },
  useRef: value => { const at = cursor++; return refs[at] ||= { current: value }; },
  useMemo: fn => { cursor++; return fn(); },
  useSyncExternalStore: (_subscribe, snapshot) => { cursor++; return snapshot(); },
  useEffect: (fn, dependencies) => { const at = cursor++; if (!previousEffects[at] || dependencies.some((value, index) => value !== previousEffects[at][index])) { effects.push(fn); previousEffects[at] = dependencies; } },
};
globalThis.blackObsidian = {
  getMusicLibrary: async () => ({ tracks: [{ id: 'piano', title: '温暖钢琴' }], directories: [{ id: 'fixture', path: 'fixture' }], revision: 'r1' }),
  analyzeWebScript: async request => { lastRequest = request; mocks++; assert.equal(request.purpose, 'batch-library-match'); assert.equal(request.provider, 'deepseek'); assert.ok(request.input.episodes.length > 0); await beforeAnalyze?.(request); return { episodes: request.input.episodes.map(episode => ({ id: episode.id, value: { analysis: { summary: '温暖情绪', keywords: ['钢琴'] }, matches: [{ id: 'piano', reason: '温暖钢琴' }], ...(request.input.segmented ? {segmented:true,segments:[{id:'segment-1',title:'重逢',startLine:1,endLine:2,summary:'重逢的温暖',keywords:['钢琴'],matches:[{id:'piano',reason:'温暖钢琴'}],evaluated:1},{id:'segment-2',title:'悬念',startLine:3,endLine:4,summary:'紧张的尾声',keywords:['悬疑'],matches:[],evaluated:1,noMatchReason:'候选钢琴缺少压迫感'}]} : {}) } })) }; },
};
const bundle = await build({ stdin: { contents: "export {BatchAnalysis} from '../app/src/BatchAnalysis.jsx'; export {batchQueue} from '../app/src/BatchAnalysisStore.mjs';", resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, write: false, format: 'esm', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const providers = [{ id: 'g', protocol: 'gemini', name: 'Gemini', apiKey: 'fixture', models: ['gemini-test'] }];
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)];
const textOf = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : (tree?.children || []).flat(Infinity).map(textOf).join('');
const findLabel = (tree, label) => nodes(tree).find(node => node.props['aria-label'] === label);
const findText = (tree, text) => nodes(tree).find(node => node.type === 'button' && textOf(node) === text);
const render = () => { cursor = 0; effects = []; return ui.BatchAnalysis({ active: true, providers, onNavigate: () => {} }); };
test('batch UI defaults are independent; paste automatically analyzes multiple episodes and cards open dialogs, close individually and clear together', async () => {
  await ui.batchQueue.initialize();
  let tree = render();
  assert.equal(findLabel(tree, '跑量字幕标点保留').props['aria-checked'], true);
  assert.match(findLabel(tree, '跑量剪辑流模型').props.value, /deepseek/);
  assert.ok(nodes(findLabel(tree, '跑量剪辑流模型')).some(node => node.type === 'option' && /gemini-test/.test(node.props.value)));
  assert.doesNotMatch(textOf(tree), /Suno|带入工作空间/);
  const first = tree.children.flat(Infinity).find(value => value && typeof value === 'object');
  assert.match(textOf(first), /字幕标点保留/);
  assert.ok(nodes(tree).some(node => typeof node.type === 'function' && node.type.name === 'MusicUsageHistory' && node.props.scope === 'batch'));
  findLabel(tree, '多集完整剧本').props.onChange({ target: { value: '第1集\n[EN] A: Hello, world.\n第2集\n[EN] B: Wait...' } });
  tree = render();
  let automatic;
  const timeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay) => { if (delay === 1400) { automatic = callback; return 100; } return timeout(callback, delay); };
  for (const effect of effects) effect();
  globalThis.setTimeout = timeout;
  assert.equal(typeof automatic, 'function'); automatic();
  for (let count = 0; count < 8; count++) await new Promise(resolve => setImmediate(resolve));
  tree = render();
  assert.equal(mocks, 1); assert.equal(record.tasks.length, 2);
  assert.ok(record.tasks.every(task => task.status === 'complete'));
  assert.equal(saved.get('xiaoma.script-projects.v1'), 'workspace-sentinel');
  assert.equal(saved.get('black-obsidian.script-draft.v1'), 'draft-sentinel');
  findLabel(tree, '查看第1集字幕与音乐').props.onClick(); tree = render();
  const modal = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'TaskDialog');
  assert.ok(modal); assert.equal(modal.props.task.episodeNumber, 1); assert.equal(modal.props.task.result.matches[0].title, '温暖钢琴');
  assert.equal(modal.props.preserve, true);
  modal.props.onClose(); tree = render();
  assert.equal(nodes(tree).some(node => typeof node.type === 'function' && node.type.name === 'TaskDialog'), false);
  await findLabel(tree, '关闭第1集卡片').props.onClick(); tree = render();
  assert.equal(record.tasks.length, 1); assert.equal(record.tasks[0].episodeNumber, 2);
  findText(tree, '清空所有卡片').props.onClick(); tree = render();
  await findText(tree, '确认清空所有卡片').props.onClick(); tree = render();
  assert.equal(record.tasks.length, 0);
  assert.equal(saved.get('xiaoma.script-projects.v1'), 'workspace-sentinel');
});


test('existing cards can be rerun in multi-segment mode and the dialog shows each scene and its empty-match reason',async()=>{
  await ui.batchQueue.import([{episodeNumber:31,title:'第31集',script:'第31集\n[EN] A: Hello.\n△ 悬念\n[EN] B: Run.'},{episodeNumber:32,title:'第32集',script:'第32集\n[EN] A: Hello.\n△ 悬念\n[EN] B: Run.'}],{analyzerKey:'webai:deepseek::DeepSeek',subtitleLanguage:'en'});
  let tree=render();
  findLabel(tree,'跑量配乐分析方式').props.onChange({target:{value:'segments'}});tree=render();
  findLabel(tree,'每集配乐段数').props.onChange({target:{value:'5'}});tree=render();
  await findText(tree,'按当前方式重新分析全部').props.onClick();
  for(let n=0;n<10;n++)await new Promise(resolve=>setImmediate(resolve));
  tree=render();
  assert.equal(lastRequest.input.segmented,true);assert.equal(lastRequest.input.segmentCount,5);assert.equal(lastRequest.input.episodes.length,2);
  assert.ok(record.tasks.every(task=>task.settings.segmented && task.result.segments.length===2));
  assert.ok(findText(tree,'补充不足五首的推荐'));
  findLabel(tree,'查看第31集字幕与音乐').props.onClick();tree=render();
  const modal=nodes(tree).find(node=>typeof node.type==='function' && node.type.name==='TaskDialog');
  // Render the dialog hooks in an isolated harness, then switch to its music tab.
  states=[];refs=[];cursor=0;previousEffects=[];effects=[];
  let detail=modal.type(modal.props);
  findText(detail,'本地音乐推荐 · 1 首').props.onClick();cursor=0;detail=modal.type(modal.props);
  assert.match(textOf(detail),/第 1 段 · 重逢/);assert.match(textOf(detail),/第 2 段 · 悬念/);
  assert.match(textOf(detail),/候选钢琴缺少压迫感/);assert.match(textOf(detail),/温暖钢琴/);
});

test('episode controls retry only this card in either mode, navigate across cards, and submit a copy once', async () => {
  await ui.batchQueue.import([{ episodeNumber: 33, title: '第33集', script: '[EN] A: Other queued episode.' }], { analyzerKey: 'webai:deepseek::DeepSeek', subtitleLanguage: 'en' });
  const parent = { states: [], refs: [], previousEffects: [] }, detail = { states: [], refs: [], previousEffects: [] };
  const within = (context, callback) => { states=context.states; refs=context.refs; previousEffects=context.previousEffects; cursor=0; effects=[]; return callback(); };
  const page = () => within(parent, render);
  const modalOf = tree => nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'TaskDialog');
  let tree = page();
  assert.equal(findLabel(tree,'跑量配乐分析方式').props.value, 'whole');
  findLabel(tree,'查看第31集字幕与音乐').props.onClick();
  let modal = modalOf(page());
  const dialog = () => { modal=modalOf(page()); return within(detail, () => modal.type(modal.props)); };
  let panel = dialog();
  assert.equal(findLabel(panel,'上一集').props.disabled, true);
  assert.equal(findLabel(panel,'本集配乐分析方式').props.value, 'segments', 'card keeps its stored mode, independent of page');
  findLabel(panel,'本集配乐段数').props.onChange({target:{value:'4'}}); panel=dialog();
  const others = structuredClone(record.tasks.slice(1));
  let release, entered;
  const started = new Promise(resolve=>{entered=resolve;});
  beforeAnalyze = async () => { entered(); await new Promise(resolve=>{release=resolve;}); };
  const running = findText(panel,'重新分析多段音乐').props.onClick();
  await started; panel=dialog();
  assert.equal(findText(panel,'正在分析…').props.disabled,true);
  assert.equal(findLabel(panel,'本集配乐分析方式').props.disabled,true);
  assert.match(textOf(panel),/完成前保留上次推荐/);
  assert.equal(lastRequest.input.episodes.length,1);assert.equal(lastRequest.input.episodes[0].episodeNumber,31);
  assert.equal(lastRequest.input.segmented,true);assert.equal(lastRequest.input.segmentCount,4);
  release(); await running; beforeAnalyze=undefined;
  assert.deepEqual(record.tasks.slice(1),others);
  assert.equal(findLabel(page(),'跑量配乐分析方式').props.value,'whole');
  panel=dialog();findLabel(panel,'下一集').props.onClick();panel=dialog();
  assert.match(textOf(panel),/第32集/);assert.match(textOf(panel),/第 1 段 · 重逢/,'music tab remains selected');
  assert.equal(findLabel(panel,'本集配乐段数').props.value,5,'next episode keeps its own count');
  findLabel(panel,'下一集').props.onClick();panel=dialog();
  assert.equal(findLabel(panel,'下一集').props.disabled,true);
  findLabel(panel,'上一集').props.onClick();panel=dialog();findLabel(panel,'上一集').props.onClick();panel=dialog();
  assert.equal(findLabel(panel,'本集配乐段数').props.value,4);
  findLabel(panel,'本集配乐分析方式').props.onChange({target:{value:'whole'}});panel=dialog();
  await findText(panel,'重新分析整段音乐').props.onClick();
  assert.equal(lastRequest.input.segmented,false);assert.equal(lastRequest.input.episodes.length,1);
  assert.equal(record.tasks[0].result.segments,undefined);assert.deepEqual(record.tasks.slice(1),others);
  panel=dialog();findText(panel,'整理字幕 · 2 行').props.onClick();panel=dialog();
  let finishCopy, copies=0;
  globalThis.blackObsidian.copySubtitleText = async text => { copies++; assert.equal(text,'Hello.\nRun.'); await new Promise(resolve=>{finishCopy=resolve;}); return {copiedLines:2,clipboardProtected:true,copyVerified:true}; };
  const button=findText(panel,'复制到剪映');const copying=button.props.onClick();await button.props.onClick();
  assert.equal(copies,1);panel=dialog();assert.equal(findText(panel,'正在复制…').props.disabled,true);
  finishCopy();await copying;panel=dialog();assert.match(textOf(panel),/已完整复制 2 行字幕/);
  globalThis.blackObsidian.copySubtitleText = async () => {throw new Error('clipboard busy');};
  await findText(panel,'复制到剪映').props.onClick();panel=dialog();
  assert.match(textOf(panel),/clipboard busy/);assert.doesNotMatch(textOf(panel),/已完整复制/);
  delete globalThis.blackObsidian.copySubtitleText;
});
