import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { parseCustomKeywords, searchMusicTitles, sameLibraryRequest } from '../app/shared/library-search.mjs';
import { validateLibraryInput, shortlistTracks, keywordMessages, matchMessages } from '../app/shared/library-match.mjs';
import { newProject, rememberProject } from '../app/shared/script-projects.mjs';
import { parseScoreResponse, scoreMessages } from '../app/shared/script-score.mjs';
import { musicFileStem, safeMusicStem } from '../app/shared/music-filename.mjs';
import { saveMusicAudio } from '../app/electron/audio-save.mjs';
import { exportScriptMaterials } from '../app/electron/material-export.mjs';
import { score, script, wav, analysis } from './script-test-fixtures.mjs';

test('custom terms deduplicate variants, preserve phrases and validate limits', () => {
  assert.deepEqual(parseCustomKeywords(' piano，Piano；悬疑、orchestral drama\nＳｏｆｔ Piano,soft-piano, !!!'), ['piano', '悬疑', 'orchestral drama', 'Ｓｏｆｔ Piano']);
  assert.deepEqual(parseCustomKeywords(), []);
  assert.throws(() => parseCustomKeywords(['piano']), /格式/);
  assert.throws(() => parseCustomKeywords('a'.repeat(1001)), /1000/);
  assert.throws(() => parseCustomKeywords('a'.repeat(61)), /60/);
  assert.throws(() => parseCustomKeywords(Array.from({ length: 21 }, (_, n) => `word${n}`).join(',')), /20/);
});
test('local title search uses OR, Chinese substrings, English words and whole phrases', () => {
  const tracks = ['悬疑紧张_钢琴', 'soft-piano orchestral_drama', 'Pianola drums', 'drama orchestral', '悲伤_钢琴'].map((title, id) => ({ title, id }));
  assert.deepEqual(searchMusicTitles(tracks, ['悬疑', 'piano', 'orchestral drama']).map(r => r.track.id), [1, 0]);
  assert.deepEqual(searchMusicTitles(tracks, ['钢琴']).map(r => r.track.id), [0, 4]);
  assert.deepEqual(searchMusicTitles(tracks, []), []);
});
test('manual terms prioritize candidates beyond the 80 title cap and reach both Gemini stages', () => {
  const tracks = Array.from({ length: 120 }, (_, n) => ({ id: String(n), title: `piano ${n}`, filename: 'private/path' }));
  tracks[119].title = '稀有悬疑大提琴';
  const input = validateLibraryInput({ script, customKeywords: '悬疑，cello', tracks });
  const candidates = shortlistTracks(input.tracks, ['piano'], input.customKeywords);
  assert.equal(candidates.length, 80); assert.equal(candidates[0].id, '119');
  for (const messages of [keywordMessages(input), matchMessages(input, analysis, candidates)]) {
    const body = JSON.parse(messages[1].content);
    assert.equal(body.originalScript, script); assert.deepEqual(body.customKeywords, ['悬疑', 'cello']);
    assert.doesNotMatch(JSON.stringify(body), /private\/path|filename/);
  }
});
test('history separates keyword variants and retains legacy recommendations', () => {
  const first = newProject({ script, customKeywords: '钢琴' });
  first.recommendation = { script, hint: '', customKeywords: '钢琴', value: { matches: ['piano'] } };
  const second = newProject({ script, customKeywords: '弦乐' });
  const history = rememberProject(rememberProject([], first), second);
  assert.equal(history.length, 2); assert.equal(history[0].recommendation, null); assert.equal(history[1].recommendation, first.recommendation);
  assert.equal(sameLibraryRequest(first.draft, second.draft), false);
  assert.equal(sameLibraryRequest({ script }, { script, customKeywords: '', hint: '' }), true);
});
test('music filename uses Gemini mood/instruments, falls back for old plans, and is Windows safe', () => {
  const planned = parseScoreResponse(JSON.stringify({ ...score, mood: '悬疑紧张', instruments: ['钢琴', '弦乐'] }));
  assert.equal(musicFileStem(planned), '悬疑紧张_钢琴_弦乐');
  assert.equal(musicFileStem(parseScoreResponse(JSON.stringify(score))), '温暖治愈_钢琴_弦乐');
  assert.equal(musicFileStem({}), '氛围配乐_器乐');
  assert.equal(safeMusicStem('CON'), '_CON'); assert.equal(safeMusicStem('../bad:name.'), '_bad_name');
  assert.doesNotMatch(musicFileStem({ mood: '../伤感:', instruments: ['钢琴/笛子'] }), /[<>:"/\\|?*]/);
  assert.match(scoreMessages({ script })[0].content, /"mood".*"instruments"/);
  assert.throws(() => parseScoreResponse(JSON.stringify({ ...score, instruments: 'piano' })), /乐器/);
});
test('concurrent Suno saves make flat unique audio files and preserve old files/folders', async () => {
  const directory = await mkdtemp(path.resolve('.generated/tests/test-audio-save-'));
  const stem = '悬疑紧张_钢琴_弦乐';
  await writeFile(path.join(directory, `${stem}.wav`), 'previous music');
  await mkdir(path.join(directory, '旧剧本文件夹'));
  const job = { script, score: { ...score, mood: '悬疑紧张', instruments: ['钢琴', '弦乐'] }, primary: { audioUrl: 'https://audio.example/music.mp3' } };
  const results = await Promise.all(Array.from({ length: 3 }, () => exportScriptMaterials({ directory, job }, { fetcher: async () => new Response(wav()) })));
  assert.equal(new Set(results.map(r => r.path)).size, 3);
  assert.equal(await readFile(path.join(directory, `${stem}.wav`), 'utf8'), 'previous music');
  for (const result of results) { assert.equal(path.dirname(result.path), directory); assert.deepEqual(await readFile(result.path), wav()); }
  assert.deepEqual((await readdir(directory)).sort(), [`${stem}.wav`, `${stem}_2.wav`, `${stem}_3.wav`, `${stem}_4.wav`, '旧剧本文件夹'].sort());
});
test('manual download uses actual audio format and failed download leaves existing contents alone', async () => {
  const directory = await mkdtemp(path.resolve('.generated/tests/test-audio-failure-'));
  await writeFile(path.join(directory, '保留.txt'), 'keep');
  const payload = { directory, url: 'https://audio.example/a.mp3', name: '温暖_钢琴' };
  await assert.rejects(saveMusicAudio(payload, { fetcher: async () => new Response(wav()), maxBytes: 20 }), /250 MB/);
  await assert.rejects(saveMusicAudio(payload, { fetcher: async () => new Response(Buffer.from('not audio but binary content')) }), /不是/);
  await assert.rejects(saveMusicAudio(payload, { fetcher: async () => new Response('<html>bad</html>', { headers: { 'content-type': 'text/html' } }) }), /文本/);
  assert.deepEqual(await readdir(directory), ['保留.txt']);
  const result = await saveMusicAudio(payload, { fetcher: async () => new Response(wav()) });
  assert.equal(path.basename(result.path), '温暖_钢琴.wav');
});
