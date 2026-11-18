import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dshKeywordMessages, dshMatchMessages } from '../app/shared/dsh-music-prompts.mjs';
import { validateLibraryInput, keywordMessages, matchMessages } from '../app/shared/library-match.mjs';
import { validateBatchMusic, batchKeywordMessages } from '../app/shared/batch-music.mjs';
import { batchCandidates } from '../app/shared/batch-candidates.mjs';
import { analyzeWithWeb, webTaskPrompt } from '../app/shared/web-script-analysis.mjs';
import { createWebAnalysis } from '../app/electron/web-ai-analysis.mjs';
import { score } from './script-test-fixtures.mjs';

const cases = JSON.parse(await readFile(new URL('./fixtures/dsh-music-cases.json', import.meta.url), 'utf8'));
const tracks = ['阴谋悬疑', '温暖亲情'].flatMap((mood, group) => [...'abcdef'].map((letter, at) => ({ id: `music-${group}-${at}`, title: `${mood}-${letter}`, relativePath: 'private-folder', absolutePath: 'E:/private/music.mp3' })));
const body = {
  episodes: [cases[0], cases[2]].map((sample, index) => ({ id: `ep-${index}`, episodeNumber: index + 1, title: `第${index + 1}集`, script: sample.script })),
  tracks, hint: '不要人声，按主线情绪选曲', customKeywords: '悬疑，亲情',
};
const data = messages => JSON.parse(messages[1].content);
const analysis = index => ({ summary: cases[index === 0 ? 0 : 2].script, keywords: index === 0 ? ['阴谋', '悬疑'] : ['温暖', '亲情'] });
const reason = unit => `${unit.summary.slice(0, 22)}；曲名的${unit.keywords[0]}与人物处境一致，适合承接本段情绪。`;
const matches = (unit, group) => unit.candidates.filter(track => track.title.includes(group === 0 ? '阴谋' : '温暖')).slice(0, 5).map(track => ({ ref: track.ref, reason: reason(unit) }));
const assertSkillStage = (messages, stage) => {
  assert.match(messages[0].content, /^默认调用已安装的 xm-script-music（剧情分析与配乐策划）Skill/);
  assert.match(messages[0].content, stage === 'analysis' ? /本轮是第一阶段：剧情分析与检索关键词/ : /本轮是第二阶段：候选音乐匹配与中文推荐理由/);
};

test('DSH keyword context preserves all eight scripts, preferences and a title-derived bounded vocabulary', () => {
  for (const sample of cases) {
    const input = validateLibraryInput({ ...sample, tracks, customKeywords: sample.customKeywords?.join('，') });
    const before = structuredClone(input);
    const messages = dshKeywordMessages(input), context = data(messages);
    assertSkillStage(messages, 'analysis');
    assert.equal(input.segmented ? context.numberedScript.map(line => line.text).join('\n') : context.originalScript, sample.script);
    assert.equal(context.musicRequirements, sample.hint || '');
    assert.deepEqual(context.customKeywords, sample.customKeywords || []);
    assert.deepEqual(context.libraryVocabulary.emotions, ['悬疑', '阴谋', '温暖', '亲情']);
    assert.deepEqual(context.libraryVocabulary.instruments, []);
    assert.doesNotMatch(JSON.stringify(messages), /private-folder|E:\/private/);
    assert.deepEqual(input, before);
    assert.match(messages[0].content, /人物意图/);
    assert.match(messages[0].content, /首项必须是主导情绪/);
    assert.match(messages[0].content, /不能放进keywords参与检索/);
  }
});

test('DSH batch keyword prompts include preferences and preserve independent line numbering', () => {
  const input = validateBatchMusic({ ...body, segmented: true, segmentCount: 3 });
  const messages = batchKeywordMessages(input, { webModel: true, companyDsh: true });
  assertSkillStage(messages, 'analysis');
  const context = data(messages);
  assert.equal(context.musicRequirements, body.hint);
  assert.deepEqual(context.customKeywords, ['悬疑', '亲情']);
  assert.deepEqual(context.episodes.map(episode => episode.id), body.episodes.map(episode => episode.id));
  context.episodes.forEach((episode, index) => {
    assert.equal(episode.numberedScript[0].line, 1);
    assert.equal(episode.numberedScript.map(row => row.text).join('\n'), body.episodes[index].script);
  });
  assert.match(messages[0].content, /不按场次或句子机械拆分/);
  const legacy = data(batchKeywordMessages(input, { webModel: true }));
  assert.deepEqual(Object.keys(legacy), ['episodes'], 'other webpage providers keep their original input contract');
});

test('DSH retrieval prioritizes plot emotion over several matching instruments without changing default ranking', () => {
  const library = [
    { id: 'opposite', title: '温暖治愈 钢琴 弦乐' },
    { id: 'right', title: '阴谋暗流' },
    { id: 'other', title: '快乐吉他' },
  ];
  assert.equal(batchCandidates(library, ['阴谋', '钢琴', '弦乐'], 3)[0].id, 'opposite');
  assert.equal(batchCandidates(library, ['阴谋', '钢琴', '弦乐'], 3, { emotionFirst: true })[0].id, 'right');
  // Hand-written keyword oracles test retrieval only, not DSH model quality.
  for (const sample of cases) {
    const library = [{ id: 'wrong', title: '无关钢琴弦乐' }, { id: 'expected', title: `${sample.expectedMood}主题` }];
    assert.equal(batchCandidates(library, sample.keywords, 2, { emotionFirst: true })[0].id, 'expected', sample.id);
  }
});

test('DSH matches all batch episodes using original stories and refs in two requests, retaining Chinese reasons', async () => {
  const requests = [];
  const result = await analyzeWithWeb('batch-library-match', body, async messages => {
    const context = data(messages); requests.push(context);
    assertSkillStage(messages, requests.length === 1 ? 'analysis' : 'matching');
    if (requests.length === 1) return JSON.stringify({ episodes: body.episodes.map((episode, index) => ({ id: episode.id, ...analysis(index) })) });
    assert.equal(context.musicRequirements, body.hint);
    assert.deepEqual(context.customKeywords, ['悬疑', '亲情']);
    assert.doesNotMatch(messages[1].content, /private-folder|E:\/private/);
    for (const [index, episode] of context.episodes.entries()) {
      assert.equal(episode.originalScript, body.episodes[index].script);
      assert(episode.candidates.every(track => /^M\d+$/.test(track.ref) && Object.keys(track).join(',') === 'ref,title'));
    }
    return JSON.stringify({ episodes: context.episodes.map((episode, index) => ({ id: episode.id, matches: matches(episode, index), noMatchReason: '' })).reverse() });
  }, { companyDsh: true });
  assert.equal(requests.length, 2);
  assert.deepEqual(result.episodes.map(episode => episode.id), body.episodes.map(episode => episode.id));
  for (const [index, episode] of result.episodes.entries()) {
    assert.equal(episode.value.matches.length, 5);
    assert(episode.value.matches.every(match => match.id.startsWith(`music-${index}-`) && /人物处境/.test(match.reason)));
  }
});

test('DSH batch correction keeps its prompt, current candidates and story, then returns validated local IDs', async () => {
  const requests = [];
  const request = { ...body, episodes: body.episodes.slice(0, 1) };
  const result = await analyzeWithWeb('batch-library-match', request, async messages => {
    const context = data(messages); requests.push(context);
    assertSkillStage(messages, requests.length === 1 ? 'analysis' : 'matching');
    if (requests.length === 1) return JSON.stringify({ episodes: [{ id: 'ep-0', ...analysis(0) }] });
    if (requests.length === 2) return JSON.stringify({ episodes: [{ id: 'ep-0', matches: [{ ref: 'M99999', reason: '无效曲目不应保存' }] }] });
    assert.match(messages[0].content, /人物意图/);
    assert.match(messages[0].content, /补充与纠正/);
    assert.equal(context.episodes[0].originalScript, body.episodes[0].script);
    assert(context.episodes[0].validationError);
    return JSON.stringify({ episodes: [{ id: 'ep-0', matches: matches(context.episodes[0], 0) }] });
  }, { companyDsh: true });
  assert.equal(requests.length, 3);
  assert.equal(result.episodes[0].value.matches.length, 5);
  assert(result.episodes[0].value.matches.every(track => track.id.startsWith('music-0-')));
});

test('DSH single and batch segmentation preserve scene boundaries and do not mix candidate references', async () => {
  const script = '林月把孩子的位置发给绑匪。\n警察救出孩子，母亲哭着抱住他。';
  const segments = [
    { title: '暗中加害', startLine: 1, endLine: 1, ...analysis(0) },
    { title: '平安团聚', startLine: 2, endLine: 2, ...analysis(1) },
  ];
  for (const batch of [false, true]) {
    let calls = 0;
    const input = { tracks, segmented: true, segmentCount: 3, hint: body.hint, ...(batch ? { episodes: [{ id: 'episode-a', episodeNumber: 5, script }] } : { script }) };
    const result = await analyzeWithWeb(batch ? 'batch-library-match' : 'library-match', input, async messages => {
      const context = data(messages); calls++;
      assertSkillStage(messages, calls === 1 ? 'analysis' : 'matching');
      if (calls === 1) return JSON.stringify(batch ? { episodes: [{ id: 'episode-a', ...analysis(0), segments }] } : { segments });
      const unit = batch ? context.episodes[0] : context;
      assert.equal(unit.originalScript, script);
      assert.deepEqual(unit.segments.map(segment => [segment.startLine, segment.endLine]), [[1, 1], [2, 2]]);
      const answer = unit.segments.map((segment, index) => ({ id: segment.id, matches: batch ? matches(segment, index) : segment.musicTitles.filter(track => track.id.startsWith(`music-${index}-`)).slice(0, 5).map(track => ({ id: track.id, reason: reason(segment) })) }));
      return JSON.stringify(batch ? { episodes: [{ id: 'episode-a', segments: answer }] } : { segments: answer });
    }, { companyDsh: true });
    assert.equal(calls, 2);
    const values = batch ? result.episodes[0].value.segments : result.segments;
    assert.deepEqual(values.map(segment => segment.matches.length), [5, 5]);
  }
});

test('DSH batch still excludes music from the previous two episodes', async () => {
  let calls = 0;
  const result = await analyzeWithWeb('batch-library-match', { ...body, episodes: [{ ...body.episodes[0], episodeNumber: 3 }], recentEpisodes: [{ episodeNumber: 1, trackIds: ['music-0-0'] }] }, async messages => {
    if (++calls === 1) return JSON.stringify({ episodes: [{ id: 'ep-0', ...analysis(0) }] });
    const episode = data(messages).episodes[0];
    assert(!episode.candidates.some(track => track.title === tracks[0].title));
    return JSON.stringify({ episodes: [{ id: episode.id, matches: matches(episode, 0) }] });
  }, { companyDsh: true });
  assert.equal(calls, 2);
  assert(!result.episodes[0].value.matches.some(track => track.id === 'music-0-0'));
});

test('DSH single repair preserves quality rules, exact IDs and current analysis without adding another keyword round', async () => {
  let calls = 0;
  const input = { script: cases[0].script, tracks: [tracks[0]] };
  const result = await analyzeWithWeb('library-match', input, async messages => {
    calls++;
    assertSkillStage(messages, calls === 1 ? 'analysis' : 'matching');
    if (calls === 1) return JSON.stringify(analysis(0));
    if (calls === 2) return '{broken';
    const context = data(messages);
    assert.match(messages[0].content, /只依据标题语义，未试听/);
    assert.deepEqual(context.analysis, analysis(0));
    assert.deepEqual(context.musicTitles, [{ id: tracks[0].id, title: tracks[0].title }]);
    assert.equal(context.previousResult, '{broken');
    return JSON.stringify({ matches: [{ id: tracks[0].id, reason: '暗中加害引出阴谋，曲名的悬疑适合突出人物表里不一与未解危险。' }] });
  }, { companyDsh: true });
  assert.equal(calls, 3); assert.equal(result.matches[0].id, tracks[0].id);
});

test('DSH single and batch supplements keep the skill in stage two and only request unfinished segments', async () => {
  const script = '林月把孩子的位置发给绑匪。\n警察救出孩子，母亲哭着抱住他。';
  const segments = [
    { title: '暗中加害', startLine: 1, endLine: 1, ...analysis(0) },
    { title: '平安团聚', startLine: 2, endLine: 2, ...analysis(1) },
  ];
  for (const batch of [false, true]) {
    let calls = 0;
    const input = { tracks, segmented: true, segmentCount: 3, ...(batch ? { episodes: [{ id: 'ep-a', episodeNumber: 5, script }] } : { script }) };
    const result = await analyzeWithWeb(batch ? 'batch-library-match' : 'library-match', input, async messages => {
      calls++;
      assertSkillStage(messages, calls === 1 ? 'analysis' : 'matching');
      if (calls === 1) return JSON.stringify(batch ? { episodes: [{ id: 'ep-a', ...analysis(0), segments }] } : { segments });
      const context = data(messages), unit = batch ? context.episodes[0] : context;
      if (calls === 3) {
        assert.equal(unit.segments.length, 1);
        assert.equal(unit.segments[0].startLine, 2, 'the completed segment must not be reanalyzed');
      }
      const answer = unit.segments.map(segment => {
        const group = segment.startLine - 1;
        const choices = batch ? matches(segment, group) : segment.musicTitles.filter(track => track.id.startsWith(`music-${group}-`)).slice(0, 5).map(track => ({ id: track.id, reason: reason(segment) }));
        return { id: segment.id, matches: calls === 2 && group === 1 ? choices.slice(0, 1) : choices, noMatchReason: '' };
      });
      return JSON.stringify(batch ? { episodes: [{ id: 'ep-a', segments: answer }] } : { segments: answer });
    }, { companyDsh: true });
    assert.equal(calls, 3, 'skill invocation must not add a separate conversation round');
    const values = batch ? result.episodes[0].value.segments : result.segments;
    assert.deepEqual(values.map(segment => segment.matches.length), [5, 5]);
  }
});

test('only company DSH uses the new prompts through the host; other automatic webpage prompts remain identical', async () => {
  const request = { script: cases[0].script, tracks: [{ id: 'safe', title: '阴谋悬疑' }] };
  const input = validateLibraryInput(request);
  for (const provider of ['dsh', 'deepseek', 'doubao']) {
    let time = 0, round = 0; const prompts = [];
    const host = createWebAnalysis({ now: () => time, delay: async ms => { time += ms; }, uuid: () => `token-${++round}`, notify: () => {}, copy: () => {}, driver: {
      visible: () => true,
      run: async (_provider, command) => {
        if (command.command === 'fill') { prompts.push(command.prompt); return { state: 'filled' }; }
        if (command.command === 'send') return { state: 'sent' };
        return { texts: [JSON.stringify({ xmTaskId: command.token, result: round === 1 ? analysis(0) : { matches: [{ id: 'safe', reason: '曲名的阴谋对应暗中加害的危险，适合呈现观众已知而角色未察觉的悬念。' }] } })], busy: false };
      },
    } });
    await host.run({ id: 'dsh-provider-test', provider, purpose: 'library-match', input: request });
    assert.equal(prompts.length, 2);
    const expected = provider === 'dsh' ? dshKeywordMessages(input) : keywordMessages(input);
    assert.equal(prompts[0], webTaskPrompt(expected, 'token-1'));
    if (provider === 'dsh') {
      for (const [index, prompt] of prompts.entries()) {
        assert.match(prompt, /^默认调用已安装的 xm-script-music/);
        assert.match(prompt, index === 0 ? /本轮是第一阶段/ : /本轮是第二阶段/);
        assert(prompt.includes(`"xmTaskId":"token-${index + 1}","result":{`), 'the skill must not replace the live task envelope');
      }
    } else assert(prompts.every(prompt => !prompt.includes('xm-script-music')));
    if (provider !== 'dsh') assert.equal(prompts[1], webTaskPrompt(matchMessages(input, analysis(0), request.tracks), 'token-2'));
  }
});

test('Suno generation keeps the same prompt even when DSH is selected', async () => {
  const captured = [];
  for (const companyDsh of [false, true]) await analyzeWithWeb('score', { script: '雨停后相拥重逢。', durationSeconds: 60 }, async messages => { captured.push(messages); return JSON.stringify(score); }, { companyDsh });
  assert.deepEqual(captured[0], captured[1]);
});

test('holdout unknown titles are not relabeled as invented audio features and prompts require source-based Chinese reasons', () => {
  const sample = cases.find(item => item.holdout);
  const input = validateLibraryInput({ script: sample.script, tracks: [{ id: 'unknown', title: 'Track 01' }] });
  assert(Object.values(data(dshKeywordMessages(input)).libraryVocabulary).every(words => words.length === 0));
  const messages = dshMatchMessages(input, { analysis: { summary: sample.script, keywords: sample.keywords }, musicTitles: input.tracks });
  assert.deepEqual(data(messages).musicTitles, input.tracks);
  assert.match(messages[0].content, /曲名语义不足以支持推荐时不要猜测/);
  assert.match(messages[0].content, /外语剧本也用中文解释/);
  assert.match(messages[0].content, /不编造BPM、速度、音色、旋律/);
});
