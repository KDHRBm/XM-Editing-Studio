import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, readFile, readdir, rename, symlink } from 'node:fs/promises';
import { splitScript, validateScoreRequest } from '../app/shared/script-score.mjs';
import { validateLibraryInput, parseKeywords, parseMatches, shortlistTracks } from '../app/shared/library-match.mjs';
import { createMusicLibrary } from '../app/electron/music-library.mjs';
import { exportScriptMaterials } from '../app/electron/material-export.mjs';
import { createDesktopServer } from '../app/server/desktop-server.mjs';
import { createScriptQueue } from '../app/shared/script-queue.mjs';
import { analysis, script, wav, startMock } from './script-test-fixtures.mjs';

const input = { script, title: '雨夜重逢', hint: '温暖克制', durationSeconds: 90, lines: splitScript(script) };
async function fixture() {
  await mkdir('.generated/tests/library-tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.generated/tests/library-tests/run-'));
  const music = path.join(root, '音乐库'), nested = path.join(music, '电影配乐');
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(music, '雨夜重逢_温暖钢琴.wav'), wav());
  await writeFile(path.join(nested, 'Quiet-Rain-Piano.wav'), wav());
  await writeFile(path.join(music, 'Comedy Dance.wav'), wav());
  await writeFile(path.join(music, '说明.txt'), 'not music');
  const library = createMusicLibrary({ settingsFile: path.join(root, 'settings.json') });
  await library.init(); const catalog = await library.connect(music);
  return { root, music, library, catalog };
}
test('screenshot subtitle formats: remove labels and Chinese, keep names, quotes, times and punctuation', () => {
  const raw = `3-1 日 外 银泉庄园大门\n出场：凯尔德沃尔、艾瑞莉\n△ 透过车窗看见一位男孩。\n守卫甲：（语气客气）你好，请问有请柬吗？\n[EN] GUARD A: Good day. May I see your invitation? Today is the funeral of the late Duke.\n\n[EN] KYLE: She went out that day and ended up in St. Mary's.\n[EN] LIVIA: She wrote, "If she sees it." She wanted me to see that cake.\n【EN】 NARRATOR：It's 10:30. I waited 3.5 hours.\n[EN GUARD B: I know.]\n[CN] 守卫乙：我知道。\nTitle: An unrelated English heading\n路人：A Chinese description with an English name.`;
  assert.deepEqual(splitScript(raw).map(l => l.text), ["Good day.", "May I see your invitation?", "Today is the funeral of the late Duke.", "She went out that day and ended up in St. Mary's.", 'She wrote, "If she sees it."', 'She wanted me to see that cake.', "It's 10:30.", "I waited 3.5 hours.", 'I know.']);
  assert.ok(splitScript(raw).every(l => !l.speaker && l.kind === 'dialogue'));
  assert.deepEqual(splitScript('Scene: A bedroom\nGUARD A: Good day.\nLivia: I love you.\n旁白：中文描述。').map(l => l.text), []);
  assert.deepEqual(splitScript('只有中文场景，没有英文字幕。'), []);
  assert.equal(validateScoreRequest({ script: '只有中文场景。', lines: [] }).script, '只有中文场景。');
});
test('wrapped English subtitle retains internal colon and stops at Chinese stage directions', () => {
  const rows = splitScript('[EN] A: She wrote,\n"If she sees it."\nAt 10:30, she left.\n△ 灯亮了。\nThis unrelated line is not a subtitle.\n[EN] B: （低声）I know. 我知道。');
  assert.deepEqual(rows.map(l => l.text), ['She wrote, "If she sees it."', 'At 10:30, she left.', 'I know.']);
});
test('keyword schema and candidate validation reject fabricated IDs; local shortlist supports Chinese and English', () => {
  assert.deepEqual(parseKeywords(JSON.stringify(analysis)), analysis);
  assert.throws(() => parseKeywords('{"summary":"ok","keywords":[]}'), /关键词/);
  const tracks = Array.from({ length: 90 }, (_, n) => ({ id: String(n), title: `Dance ${n}` })); tracks[89].title = 'Rain_piano 释然';
  const selected = shortlistTracks(tracks, ['雨夜', 'rain', 'piano', '释然']); assert.equal(selected.length, 1); assert.equal(selected[0].id, '89');
  assert.throws(() => parseMatches(JSON.stringify({ matches: [{ id: 'fake', reason: 'ok', keywords: [] }] }), selected), /无效/);
  assert.deepEqual(parseMatches('{"matches":[]}', selected), []);
  const checked = validateLibraryInput({ ...input, tracks: [{ id: 'music-1', title: 'Rain', filename: 'C:/private/music.wav', apiKey: 'secret' }] });
  assert.deepEqual(checked.tracks, [{ id: 'music-1', title: 'Rain' }]);
});
test('library scans recursive audio only, deduplicates roots, persists and refreshes added tracks', async () => {
  const { root, music, library, catalog } = await fixture(); assert.equal(catalog.tracks.length, 3); assert.equal(catalog.directories.length, 1); assert.ok(catalog.tracks.some(t => t.relativePath.includes('电影配乐')));
  assert.equal((await library.connect(music)).directories.length, 1);
  await writeFile(path.join(music, '温暖重逢新音乐.wav'), wav()); assert.equal((await library.refresh()).tracks.length, 4);
  const restored = createMusicLibrary({ settingsFile: path.join(root, 'settings.json') }); assert.equal((await restored.init()).tracks.length, 4);
  assert.equal((await library.disconnect(catalog.directories[0].id)).tracks.length, 0); assert.equal((await readdir(music)).length, 5);
});

test('music matches normalize whitespace, duplicate recommendations and optional keyword metadata', () => {
  const candidates = [{ id: 'piano_1', title: '温暖钢琴' }, { id: 'drums-2', title: '紧张鼓点' }];
  const parse = matches => parseMatches(JSON.stringify({ matches }), candidates);
  assert.deepEqual(parse([
    { id: ' piano_1\n', reason: ' 适合温暖重逢。 ', keywords: '温暖，钢琴, 温暖；' },
    { id: 'piano_1', reason: '重复推荐' },
    { id: 'drums-2', reason: '适合追逐' },
  ]), [
    { id: 'piano_1', reason: '适合温暖重逢。', keywords: ['温暖', '钢琴'] },
    { id: 'drums-2', reason: '适合追逐', keywords: [] },
  ]);
  assert.equal(parse(Array.from({ length: 10 }, () => ({ id: 'piano_1', reason: '温暖' }))).length, 1);
  assert.deepEqual(parse([{ id: 'piano_1', reason: '温暖', keywords: null }])[0].keywords, []);
  for (const id of ['温暖钢琴', 'piano', 'PIANO_1', '../piano_1', 1, null]) {
    assert.throws(() => parse([{ id, reason: '温暖' }]), /ID 无效/);
  }
  for (const reason of ['', '  ', null, {}, 'x'.repeat(501)]) {
    assert.throws(() => parse([{ id: 'piano_1', reason }]), /匹配理由无效/);
  }
  for (const keywords of [{ warm: true }, [null], [1], ['x'.repeat(61)], Array(21).fill('warm')]) {
    assert.throws(() => parse([{ id: 'piano_1', reason: '温暖', keywords }]), /关键词格式无效/);
  }
  const many = Array.from({ length: 9 }, (_, at) => ({ id: String(at), title: '钢琴', reason: '温暖' }));
  assert.throws(() => parseMatches(JSON.stringify({ matches: many }), many), /最多8首/);
});
test('library resolves only indexed unchanged audio and skips directory junctions', async () => {
  const { root, music, library, catalog } = await fixture(); const track = catalog.tracks[0];
  await assert.rejects(library.resolve('../settings.json'), /移除/);
  const file = await library.resolve(track.id); await writeFile(file.filename, Buffer.concat([wav(), Buffer.from([0])])); await assert.rejects(library.resolve(track.id), /更新/);
  await library.refresh(); assert.equal((await library.resolve(track.id)).size, wav().length + 1);
  await rename(file.filename, file.filename + '.moved'); await assert.rejects(library.resolve(track.id), /移动或删除/);
  const outside = path.join(root, '未连接目录'); await mkdir(outside); await writeFile(path.join(outside, '秘密音乐.wav'), wav());
  await symlink(outside, path.join(music, 'junction'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok(!(await library.refresh()).tracks.some(t => t.title === '秘密音乐'));
});
test('scan bounds are reported and connected roots remain visible', async () => {
  const { root, music } = await fixture(); const other = path.join(root, '另一文件夹'); await mkdir(other); await writeFile(path.join(other, 'extra.wav'), wav());
  const limited = createMusicLibrary({ settingsFile: path.join(root, 'limited.json'), limit: 1 }); await limited.connect(music); const result = await limited.connect(other);
  assert.equal(result.tracks.length, 1); assert.equal(result.directories.length, 2); assert.match(result.warning, /限制/); assert.match(result.directories[1].error, /上限/);
});
test('local audio supports seeking, rejects invalid IDs and foreign origins', async () => {
  const { library, catalog } = await fixture(); const app = await createDesktopServer({ clientDirectory: path.resolve('app/dist/client'), port: 0, musicLibrary: library });
  const base = `http://127.0.0.1:${app.address().port}`, url = `${base}/local-music/${catalog.tracks[0].id}`;
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=10-19' } }); assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 10-19/16044'); assert.equal((await response.arrayBuffer()).byteLength, 10);
    const tail = await fetch(url, { headers: { Range: 'bytes=-10' } }); assert.equal((await tail.arrayBuffer()).byteLength, 10);
    assert.equal((await fetch(url, { headers: { Range: 'bytes=999999-1000000' } })).status, 416);
    assert.equal((await fetch(url, { headers: { Origin: 'https://unrelated.example' } })).status, 403);
    assert.equal((await fetch(base + '/local-music/bad')).status, 404);
    const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.headers.get('content-length'), '16044');
  } finally { await new Promise(resolve => app.close(resolve)); }
});
test('Gemini sees the complete script and only music IDs/titles; matching makes no Suno call', async () => {
  const { catalog, music } = await fixture(); const mock = await startMock(); const app = await createDesktopServer({ clientDirectory: path.resolve('app/dist/client'), port: 0 });
  const url = `http://127.0.0.1:${app.address().port}/api/script/library-match`;
  try {
    for (const protocol of ['gemini', 'openai']) {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, customKeywords: '温暖,piano', provider: { protocol, baseUrl: mock.url + '/v1', apiKey: 'local-key' }, model: 'gemini-test', tracks: catalog.tracks.map(track => ({ ...track, filename: music + '/private' })) }) });
      const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); assert.equal(data.matches.length, 2); assert.equal(data.total, 3); assert.deepEqual(data.analysis.keywords, analysis.keywords);
      assert.deepEqual(data.customKeywords, ['温暖', 'piano']);
    }
    assert.equal(mock.calls.length, 4); assert.ok(mock.calls.every(call => !call.url.includes('/suno/')));
    for (const call of mock.calls) { const body = JSON.stringify(call.body); assert.ok(body.includes('场景：雨夜')); assert.ok(body.includes('林夏：')); assert.ok(!body.includes('relativePath')); assert.ok(!body.includes('filename')); assert.ok(!body.includes(music)); }
    for (const call of mock.calls) {
      const userText = call.body.messages?.find(message => message.role === 'user')?.content || call.body.contents?.[0]?.parts?.[0]?.text;
      assert.deepEqual(JSON.parse(userText).customKeywords, ['温暖', 'piano']);
    }
  } finally { await new Promise(resolve => app.close(resolve)); await mock.close(); }
});
test('selected local music is copied with English-only materials, no provider calls, original unchanged', async () => {
  const { root, library, catalog } = await fixture(); let paidCalls = 0, exports = 0, saved;
  const track = catalog.tracks[0]; const original = await library.resolve(track.id); const before = await readFile(original.filename);
  const q = createScriptQueue({ save: value => { saved = structuredClone(value); }, request: async () => { paidCalls++; throw new Error('must not call provider'); }, getProvider: () => { throw new Error('must not require a provider'); }, exportMaterials: async payload => { exports++; return exportScriptMaterials(payload, { resolveLocalTrack: library.resolve, fetcher: () => { throw new Error('must not download'); } }); } });
  const id = q.addLocal(input, track, analysis, '钢琴与温暖情绪相符', path.join(root, '素材'), 'http://127.0.0.1:37651');
  await q.tick(); assert.equal(paidCalls, 0); assert.equal(exports, 1); const job = q.snapshot().jobs[0]; assert.equal(job.exportState, 'done'); assert.equal(job.source, 'library');
  assert.deepEqual(await readFile(original.filename), before); assert.deepEqual(await readFile(path.join(job.exportPath, '配乐.wav')), before);
  const texts = await readFile(path.join(job.exportPath, '逐行台词.txt'), 'utf8'); assert.ok(texts.includes('Why are you')); assert.doesNotMatch(texts, /[\p{Script=Han}]|\[EN\]|LIN:/u);
  const files = await readdir(job.exportPath); assert.equal(files.length, 9); assert.ok(files.includes('配乐匹配说明.json')); assert.ok(!files.includes('Suno提示词.json'));
  assert.doesNotMatch(JSON.stringify(saved), /apiKey|filename/);
  await q.export(id, path.join(root, '素材')); assert.equal(paidCalls, 0); assert.equal(exports, 2);
  const json = await readFile(path.join(job.exportPath, '素材清单.json'), 'utf8'); assert.match(json, /local-library/);
});
