import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { MUSIC_USAGE_KEY, createMusicUsageStore, rememberMusicUsage, normalizeMusicUsage, excludeUsedMusic, shuffleMusicResults } from '../app/shared/library-usage.mjs';

const tracks = Array.from({ length: 15 }, (_, n) => ({ id: `track-${n}`, title: `悬疑_钢琴_${n}`, relativePath: `音乐/${n}.mp3` }));
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
test('recent usage deduplicates, caps at ten, persists and releases the oldest song', () => {
  const storage = memory(), store = createMusicUsageStore(storage);
  tracks.slice(0, 11).forEach(track => store.remember(track));
  assert.deepEqual(store.snapshot().history.map(t => t.id), tracks.slice(1, 11).reverse().map(t => t.id));
  assert.deepEqual(excludeUsedMusic(tracks, store.snapshot().history).map(t => t.id), [tracks[0], ...tracks.slice(11)].map(t => t.id));
  store.remember(tracks[4]);
  assert.equal(store.snapshot().history.length, 10);
  assert.equal(store.snapshot().history[0].id, tracks[4].id);
  assert.deepEqual(createMusicUsageStore(storage).snapshot().history, store.snapshot().history);
  assert.deepEqual(normalizeMusicUsage([null, {}, ...store.snapshot().history, store.snapshot().history[0]]), store.snapshot().history);
});
test('storage failure preserves in-session exclusion and reports persistence failure', () => {
  const store = createMusicUsageStore({ getItem: () => '{bad', setItem: () => { throw new Error('quota'); } });
  assert.match(store.snapshot().error, /读取失败/);
  store.remember(tracks[0]);
  assert.match(store.snapshot().error, /无法保存/);
  assert.equal(excludeUsedMusic(tracks, store.snapshot().history).length, 14);
});
test('shuffle does not mutate or lose candidates, and never reintroduces used tracks', () => {
  const candidates = excludeUsedMusic(tracks, rememberMusicUsage([], tracks[0]));
  const before = [...candidates], result = shuffleMusicResults(candidates, () => 0);
  assert.deepEqual(candidates, before);
  assert.notDeepEqual(result, before);
  assert.deepEqual(result.map(t => t.id).sort(), before.map(t => t.id).sort());
  assert.deepEqual(shuffleMusicResults([]), []);
  assert.deepEqual(shuffleMusicResults([tracks[0]]), [tracks[0]]);
});

globalThis.localStorage = memory();
const bundle = await build({ stdin: { contents: "export {MusicLibrary,clearCurrentLibraryMatch} from '../app/src/MusicLibrary.jsx'; export {musicUsage} from '../app/src/MusicUsage.mjs';", resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, write: false, format: 'esm', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment', target: 'es2022' });
const { MusicLibrary, musicUsage, clearCurrentLibraryMatch } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let slots = [], cursor = 0, catalog = { directories: [], tracks, revision: 'fixture' };
globalThis.i = {
  useRef: value => ({ current: value }),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial?.tracks ? catalog : typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  },
  useEffect: () => {},
  useMemo(fn, deps) {
    const index = cursor++, previous = slots[index];
    if (!previous || deps.some((dep, n) => !Object.is(dep, previous.deps[n]))) slots[index] = { deps, value: fn() };
    return slots[index].value;
  },
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
};
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)];
const textOf = tree => typeof tree === 'string' ? tree : (tree?.children || []).flat(Infinity).map(textOf).join('');
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && textOf(node) === label);
const render = props => { cursor = 0; return MusicLibrary(props); };
const input = { script: '[EN] JACK: Hello.', customKeywords: '悬疑', title: 'fixture' };
const props = { input, projectId: 'test', lines: [], gemini: { provider: { apiKey: 'fixture' }, model: 'fixture' }, onChange: () => {}, onAnalysis: () => {}, onUse: async () => {} };
const searchIds = tree => nodes(tree).filter(node => node.type === 'audio' && node.props['aria-label']?.startsWith('检索试听')).map(node => node.props.src);

test('UI random order stays stable across rerenders/pages; relevance mode restores ordering', () => {
  slots = [];
  let tree = render(props), first = searchIds(tree);
  assert.equal(first.length, 5);
  assert.deepEqual(searchIds(render(props)), first);
  const pages = nodes(tree).find(node => node.props.label === '自定义检索结果页码');
  pages.props.setPage(2); tree = render(props);
  assert.equal(searchIds(tree).length, 5);
  assert(!searchIds(tree).some(id => first.includes(id)));
  button(tree, '按匹配度').props.onClick();
  pages.props.setPage(1); tree = render(props);
  assert.deepEqual(searchIds(tree), tracks.slice(0, 5).map(t => '/local-music/' + t.id));
});
test('successful use records once, failed use/preview does not, and other scripts share exclusions', async () => {
  slots = [];
  let tree = render({ ...props, onUse: async () => { throw new Error('queue full'); } });
  const selected = searchIds(tree)[0].split('/').at(-1);
  await button(tree, '选用此音乐').props.onClick();
  assert.equal(musicUsage.snapshot().history.length, 0);
  tree = render(props);
  assert.equal(musicUsage.snapshot().history.length, 0);
  await button(tree, '选用此音乐').props.onClick();
  assert.equal(musicUsage.snapshot().history[0].id, selected);
  assert(!searchIds(render({ ...props, projectId: 'another' })).includes('/local-music/' + selected));
  assert.equal(JSON.parse(localStorage.getItem(MUSIC_USAGE_KEY))[0].id, selected);
  clearCurrentLibraryMatch('test', input);
  assert.equal(musicUsage.snapshot().history[0].id, selected);
});
test('manual usage works without a script; Gemini receives only eligible candidates', async () => {
  slots = [];
  let tree = render({ ...props, input: { ...input, script: '' } });
  assert(button(tree, '选用此音乐').props.disabled);
  const count = musicUsage.snapshot().history.length;
  button(tree, '标记已使用').props.onClick();
  assert.equal(musicUsage.snapshot().history.length, count + 1);
  let submitted;
  globalThis.fetch = async (_url, options) => { submitted = JSON.parse(options.body); return { ok: true, json: async () => ({ analysis: { summary: '', keywords: [] }, matches: [] }) }; };
  tree = render(props);
  await button(tree, 'fixture 结合自定义关键词匹配').props.onClick();
  assert.equal(submitted.tracks.length, tracks.length - musicUsage.snapshot().history.length);
  assert(!submitted.tracks.some(t => musicUsage.snapshot().history.some(h => h.id === t.id)));
});
test('segment selection also records usage; history survives disconnected tracks and all-used search is explicit', async () => {
  slots = [];
  const recommendation = { ...input, value: { analysis: { summary: '', keywords: [] }, segments: [], matches: [] } };
  let tree = render({ ...props, savedRecommendation: recommendation });
  const segments = nodes(tree).find(node => typeof node.type === 'function' && 'segments' in node.props);
  await segments.props.onUse(tracks[14], {}, '', []);
  assert.equal(musicUsage.snapshot().history[0].id, tracks[14].id);
  tracks.slice(0, 10).forEach(t => musicUsage.remember(t));
  catalog = { ...catalog, tracks: tracks.slice(0, 10) }; slots = []; tree = render(props);
  assert.equal(searchIds(tree).length, 0);
  assert.match(textOf(tree), /匹配的音乐都在最近使用记录中/);
  let history = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'MusicUsageHistory');
  slots = []; cursor = 0; assert(nodes(history.type(history.props)).some(node => node.props.label === '历史使用音乐页码'));
  catalog = { ...catalog, tracks: [] }; slots = []; tree = render(props);
  history = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'MusicUsageHistory');
  slots = []; cursor = 0; assert.match(textOf(history.type(history.props)), /音乐当前未连接或已移除/);
  assert.equal(musicUsage.snapshot().history.length, 10);
});

test('marking segment and whole recommendations shares recent history without creating a music task', () => {
  catalog = { directories: [], tracks, revision: 'fixture' }; slots = [];
  let uses = 0;
  const segmentedInput = { ...input, segmented: true }, selected = tracks[12];
  const recommendation = { ...segmentedInput, revision: 'fixture', value: { analysis: { summary: '故事', keywords: ['悬疑'] }, segments: [{ id: 'segment-1', title: '第一幕', startLine: 1, endLine: 1, summary: '悬疑', keywords: ['悬疑'], matches: [{ id: selected.id, title: selected.title, reason: '适合', keywords: ['悬疑'] }] }], matches: [] } };
  const currentProps = { ...props, input: segmentedInput, savedRecommendation: recommendation, onUse: () => uses++ };
  const segmentTree = tree => {
    const wrapper = nodes(tree).find(node => typeof node.type === 'function' && 'segments' in node.props);
    const segment = nodes(wrapper.type(wrapper.props)).find(node => typeof node.type === 'function' && node.props.segment);
    slots = []; cursor = 0; return segment.type(segment.props);
  };
  let segment = segmentTree(render(currentProps));
  button(segment, '标记已使用').props.onClick();
  assert.equal(uses, 0); assert.equal(musicUsage.snapshot().history[0].id, selected.id);
  assert.equal(JSON.parse(localStorage.getItem(MUSIC_USAGE_KEY))[0].id, selected.id);
  slots = []; segment = segmentTree(render(currentProps)); assert.equal(button(segment, '已标记使用').props['aria-pressed'], true);
  button(segment, '已标记使用').props.onClick();assert.ok(!musicUsage.snapshot().history.some(t=>t.id===selected.id));
  slots=[];segment=segmentTree(render(currentProps));button(segment,'标记已使用').props.onClick();
  slots = []; assert(!searchIds(render(props)).includes('/local-music/' + selected.id));
  const whole = tracks[13]; slots = [];
  const wholeTree = render({ ...props, onUse: () => uses++, savedRecommendation: { ...input, revision: 'fixture', value: { analysis: { summary: '', keywords: [] }, matches: [{ id: whole.id, title: whole.title, reason: '适合', keywords: [] }] } } });
  const article = nodes(wholeTree).find(node => node.type === 'article' && nodes(node).some(child => child.type === 'audio' && child.props['aria-label'] === '试听 ' + whole.title));
  button(article, '标记已使用').props.onClick(); assert.equal(musicUsage.snapshot().history[0].id, whole.id); assert.equal(uses, 0); assert.equal(musicUsage.snapshot().history.length, 10);
});

test('search cards remain available for marking and selection undo; the next search excludes used music', async () => {
  catalog = { directories: [], tracks, revision: 'fixture' }; slots = [];
  musicUsage.snapshot().history.forEach(track => musicUsage.forget(track.id));
  const selected = new Set();
  const currentProps = { ...props, isSelected: track => selected.has(track.id), onUse: track => {
    if (selected.has(track.id)) { selected.delete(track.id); return false; }
    selected.add(track.id); return true;
  } };
  let tree = render(currentProps);
  const first = searchIds(tree)[0];
  await button(tree, '选用此音乐').props.onClick();
  tree = render(currentProps);
  assert.equal(searchIds(tree)[0], first);
  assert.equal(button(tree, '已选用 · 点击取消').props['aria-pressed'], true);
  await button(tree, '已选用 · 点击取消').props.onClick();
  tree = render(currentProps);
  assert.equal(selected.size, 0); assert.equal(musicUsage.snapshot().history.length, 0);
  assert.equal(button(tree, '选用此音乐').props['aria-pressed'], false);
  button(tree, '标记已使用').props.onClick(); tree = render(currentProps);
  assert.equal(searchIds(tree)[0], first);
  button(tree, '已标记使用').props.onClick(); tree = render(currentProps);
  assert.equal(musicUsage.snapshot().history.length, 0);
  button(tree, '标记已使用').props.onClick(); tree = render(currentProps);
  button(tree, '随机换一批').props.onClick(); tree = render(currentProps);
  assert(!searchIds(tree).includes(first));
});

test('whole recommendation cancel clears usage only after success, including when recommendations become stale', async () => {
  slots = []; const track = tracks[11]; musicUsage.remember(track);
  let selected = true, fail = true;
  const changedInput = { ...input, script: input.script + '\n[EN] MIA: Hi.' };
  const currentProps = { ...props, input: changedInput, isSelected: item => selected && item.id === track.id,
    savedRecommendation: { ...changedInput, customKeywords: '旧关键词', value: { analysis: { summary: '', keywords: [] }, matches: [{ id: track.id, reason: '适合', keywords: [] }] } },
    onUse: () => { if (fail) throw new Error('正在导出'); selected = false; return false; } };
  let tree = render(currentProps);
  assert.equal(button(tree, '已选用 · 点击取消').props.disabled, false);
  await button(tree, '已选用 · 点击取消').props.onClick();
  assert(musicUsage.snapshot().history.some(item => item.id === track.id));
  fail = false; tree = render(currentProps);
  await button(tree, '已选用 · 点击取消').props.onClick();
  assert(!musicUsage.snapshot().history.some(item => item.id === track.id));
  tree = render(currentProps); assert.equal(button(tree, '请重新匹配').props.disabled, true);
});

test('folder drop forwards native File objects once while scanning and refreshes the catalog', async () => {
  const previous = globalThis.blackObsidian;
  let finish, calls = 0, prevented = 0;
  const files = [{name:'配乐文件夹'}];
  globalThis.blackObsidian = {getMusicLibrary: async () => catalog, connectDroppedMusicFolders: input => {
    assert.deepEqual(input, files); calls++;
    return new Promise(resolve => {finish=resolve;});
  }};
  try {
    slots=[];
    const tree=render(props), area=nodes(tree).find(node => typeof node.props.onDrop === 'function');
    assert(area);
    const event={dataTransfer:{types:['Files'],files},preventDefault:()=>prevented++,stopPropagation:()=>{}};
    area.props.onDrop(event);area.props.onDrop(event);
    assert.equal(calls,1);assert.equal(prevented,2);
    finish({directories:[{id:'new-folder',path:'fixture',count:1}],tracks:[tracks[0]],revision:'dropped'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(textOf(render(props)),/音乐索引已更新/);
  } finally {globalThis.blackObsidian=previous;}
});
