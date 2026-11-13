import test from 'node:test';
import assert from 'node:assert/strict';
import { batchCandidates } from '../app/shared/batch-candidates.mjs';
import { batchKeywordMessages, batchMatchMessages, analyzeBatchMusic } from '../app/shared/batch-music.mjs';
import { createApiService } from '../app/shared/api-service.mjs';

const local = { localModel: true, deepseekApi: true };
const script = '母亲轻轻抱住康复的女儿。\n女儿说：“妈妈，我们回家。”';
const tracks = [
  { id: 'warm', title: '温暖治愈_钢琴' },
  { id: 'dark', title: '黑暗压抑_钢琴_大提琴_弦乐' },
];
const input = { episodes: [{ id: 'ep1', episodeNumber: 1, script }], tracks, recentEpisodes: [] };
const reason = '“母亲轻轻抱住康复的女儿”对应《温暖治愈_钢琴》的温暖亲情语义。';
const analysis = { episodes: [{ id: 'ep1', summary: '母女重逢，相拥回家，亲情温暖。', keywords: ['温暖', '治愈'] }] };

test('local retrieval ranks scene emotion above several matching instruments', () => {
  const result = batchCandidates(tracks, ['温暖', '钢琴', '大提琴', '弦乐'], 2, local);
  assert.equal(result[0].id, 'warm');
});

test('primary grief is not displaced by two secondary dark mood tags', () => {
  const result = batchCandidates([{ id:'dark',title:'黑暗压抑_大提琴' },{id:'sad',title:'悲伤_钢琴'},{id:'sorrow',title:'伤感剧情'}], ['悲伤','压抑','黑暗'], 3, local);
  assert.equal(result[0].id, 'sad');
  assert.equal(result[1].id, 'sorrow');
});

test('explicit combat is more specific than its generic tension tag', () => {
  const result = batchCandidates([{id:'office',title:'现代紧张悬疑剧情'},{id:'action',title:'激烈战斗_鼓'},{id:'epic',title:'史诗战斗'}], ['紧张','冲突','战斗'], 3, local);
  assert.equal(result[0].id, 'action');
  assert.equal(result[1].id, 'epic');
});

test('local retrieval honors instrument preferences within the suitable emotion', () => {
  const result = batchCandidates([{id:'plain',title:'温暖治愈'},{id:'piano',title:'温暖_钢琴'},{id:'bad',title:'黑暗_钢琴'}], ['温暖'], 3, { ...local, customKeywords:['钢琴'] });
  assert.equal(result[0].id, 'piano');
  assert.equal(result[1].id, 'plain');
});

test('local keyword payload reflects the connected library without sending paths or all titles', () => {
  const body = JSON.parse(batchKeywordMessages(input, local)[1].content);
  assert.ok(body.libraryVocabulary, 'keyword request must include the current title vocabulary');
  assert.ok(body.libraryVocabulary.emotions.includes('温暖'));
  assert.ok(body.libraryVocabulary.instruments.includes('钢琴'));
  assert.ok(!body.libraryVocabulary.instruments.includes('管风琴'));
  assert.ok(!JSON.stringify(body.libraryVocabulary).includes('温暖治愈_钢琴'));
  const other = JSON.parse(batchKeywordMessages({ ...input, tracks: [{ id: 'new', title: '轻松喜剧_鲁特琴' }] }, local)[1].content);
  assert.ok(other.libraryVocabulary.instruments.includes('鲁特琴'));
  assert.ok(!other.libraryVocabulary.instruments.includes('钢琴'));
});

test('local match context contains only the correct section original text and bounded excerpts', () => {
  const source = { ...input, episodes: [{ ...input.episodes[0], script: script + '\n陌生人踹开铁门，举枪逼近母女。' }] };
  const units = [{ id: 'ep1', segments: [
    { id: 'segment-1', startLine: 1, endLine: 2, candidates: tracks },
    { id: 'segment-2', startLine: 3, endLine: 3, candidates: tracks },
  ] }];
  const body = JSON.parse(batchMatchMessages(source, units, local)[1].content);
  assert.match(body.episodes[0].segments[0].originalScene, /母亲轻轻抱住/);
  assert.doesNotMatch(body.episodes[0].segments[0].originalScene, /踹开铁门/);
  assert.match(body.episodes[0].segments[1].originalScene, /踹开铁门/);
  assert.doesNotMatch(body.episodes[0].segments[1].originalScene, /母亲轻轻抱住/);
  const long = { ...input, episodes: [{ ...input.episodes[0], script: '这是较长的剧情原文。'.repeat(1000) }] };
  const context = JSON.parse(batchMatchMessages(long, [{ id: 'ep1', candidates: tracks }], local)[1].content);
  assert.ok(context.episodes[0].originalScene.length <= 2410);
});

test('local matching sends title mood without instrument bait while preserving references', () => {
  const body = JSON.parse(batchMatchMessages(input, [{ id:'ep1',candidates:tracks }], local)[1].content);
  assert.deepEqual(body.episodes[0].candidates, [{ref:'M1',title:'温暖治愈'},{ref:'M2',title:'黑暗压抑'}]);
});

test('valid grounded reasons survive the local workflow without another inference', async () => {
  let calls = 0;
  const result = await analyzeBatchMusic(input, async () => {
    calls++;
    if (calls === 1) return JSON.stringify(analysis);
    return JSON.stringify({ episodes: [{ id: 'ep1', matches: [{ ref: 'M1', reason }], noMatchReason: '其余候选情绪压抑，与母女重逢不符。' }] });
  }, local);
  assert.equal(result.episodes[0].value.matches[0].reason, reason);
  assert.equal(calls, 2);
});

test('reason repairs request only deficient tracks with a JSON schema', async () => {
  const list = [tracks[0], { id: 'family', title: '亲情温馨' }];
  let calls = 0, repair;
  const fixed = '“女儿说”之后提到“妈妈，我们回家”，《亲情温馨》呼应团聚后的亲情。';
  const result = await analyzeBatchMusic({ ...input, tracks: list }, async (messages, stage, schema) => {
    calls++;
    if (calls === 1) return JSON.stringify(analysis);
    if (calls === 2) return JSON.stringify({ episodes: [{ id: 'ep1', matches: [{ ref: 'M1', reason }, { ref: 'M2', reason: '适合本段剧情。' }], noMatchReason: '' }] });
    repair = { messages, schema };
    return JSON.stringify({ reasons: [{ label: 'R2', reason: fixed }] });
  }, local);
  const matches = result.episodes[0].value.matches;
  assert.equal(matches[0].reason, reason);
  assert.equal(matches[1].reason, fixed);
  assert.equal(calls, 3);
  assert.deepEqual(repair.schema.properties.reasons.items.properties.label.enum, ['R2']);
  assert.doesNotMatch(repair.messages[1].content, /温暖治愈_钢琴/);
});

test('English original dialogue can ground a Chinese reason without a rewrite', async () => {
  const foreign = 'Maya hugs her mother.\nShe says: We can finally go home.';
  const explanation = '“Maya hugs her mother”写出母女相拥，《温暖治愈_钢琴》呼应团聚后的温暖。';
  let calls = 0;
  const result = await analyzeBatchMusic({ ...input, episodes: [{ ...input.episodes[0], script: foreign }] }, async () => {
    calls++;
    return JSON.stringify(calls === 1 ? analysis : { episodes: [{ id: 'ep1', matches: [{ ref: 'M1', reason: explanation }], noMatchReason: '另一首情绪压抑，不适合温暖团聚。' }] });
  }, local);
  assert.equal(calls, 2);
  assert.equal(result.episodes[0].value.matches[0].reason, explanation);
});

test('local evidence line binds the saved reason to verbatim original text and real title', async () => {
  let calls = 0;
  const result = await analyzeBatchMusic(input, async () => {
    calls++;
    return JSON.stringify(calls === 1 ? analysis : { episodes: [{ id: 'ep1', matches: [{ ref: 'M1', evidenceLine: 1, reason: '曲名的温暖治愈对应母女重逢后的亲情与释然。' }], noMatchReason: '其他候选与亲情团聚情绪不符。' }] });
  }, local);
  assert.equal(calls, 2);
  assert.match(result.episodes[0].value.matches[0].reason, /“母亲轻轻抱住康复的女儿。”/);
  assert.match(result.episodes[0].value.matches[0].reason, /《温暖治愈_钢琴》/);
});

test('long real titles and evidence do not discard an otherwise valid local recommendation', async () => {
  let calls=0;
  const title='温暖'.repeat(118),longScript='母亲抱住康复的女儿，两人终于团聚。'.repeat(20);
  const result=await analyzeBatchMusic({...input,episodes:[{...input.episodes[0],script:longScript}],tracks:[{id:'long',title}]},async()=>{
    calls++;
    return JSON.stringify(calls===1?analysis:{episodes:[{id:'ep1',matches:[{ref:'M1',evidenceLine:1,reason:'曲名温暖治愈对应母女重逢后的亲情与释然。'.repeat(4)}],noMatchReason:''}]});
  },local);
  assert.equal(calls,2);
  assert.equal(result.episodes[0].value.matches[0]?.id,'long');
  assert.ok(result.episodes[0].value.matches[0].reason.length<=500);
});

test('an evidence line outside the section cannot manufacture a grounded reason', async () => {
  let calls = 0;
  const script = '母亲抱住女儿。\n陌生人踹开铁门。';
  const result = await analyzeBatchMusic({ ...input, segmented: true, segmentCount: 2, episodes: [{ ...input.episodes[0], script }] }, async () => {
    calls++;
    if (calls === 1) return JSON.stringify({ episodes: [{ id: 'ep1', summary: '团聚突遇袭击。', keywords: ['温暖','危险'], segments: [{ title:'团聚',startLine:1,endLine:1,summary:'母女相拥',keywords:['温暖'] },{ title:'袭击',startLine:2,endLine:2,summary:'陌生人破门',keywords:['危险'] }] }] });
    if (calls === 2) return JSON.stringify({ episodes: [{ id:'ep1',segments:[{id:'segment-1',matches:[{ref:'M1',evidenceLine:2,reason:'配乐的温暖标签对应紧紧相拥后的亲情与释然。'}],noMatchReason:'其他候选不适合本段团聚情绪。'},{id:'segment-2',matches:[],noMatchReason:'没有适合袭击场景的候选曲目。'}]}] });
    return JSON.stringify({ reasons: [{label:'R1',reason:'“母亲抱住女儿”写出团聚动作，曲名温暖治愈对应母女的亲情。'}] });
  }, local);
  assert.equal(calls, 3);
  assert.doesNotMatch(result.episodes[0].value.segments[0].matches[0].reason, /踹开/);
});

test('local single workspace uses the same schema and library-aware path on a fresh profile', async () => {
  const requests = [];
  const provider = { id: 'local', name: '本地', protocol: 'ollama', baseUrl: '', apiKey: '', models: ['qwen3.5:4b'] };
  const api = createApiService(async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const body = JSON.parse(request.messages[1].content), row = body.episodes?.[0];
    const content = row ? requests.length === 1
      ? { episodes: [{ id: row.id, summary: '母女重逢，温馨治愈。', keywords: ['温暖'] }] }
      : { episodes: [{ id: row.id, matches: [{ ref: row.candidates[0].ref, reason }], noMatchReason: '其他候选与亲情团聚不符。' }] }
      : requests.length === 1 ? { summary: '母女重逢', keywords: ['温暖'] } : { matches: [{ id: 'warm', reason }], noMatchReason: '其他候选与亲情团聚不符。' };
    return Response.json({ message: { content: JSON.stringify(content) }, done_reason: 'stop' });
  });
  const result = await api('/api/script/library-match', { provider, model: 'qwen3.5:4b', script, tracks, hint: '突出亲情', customKeywords: '温暖' });
  assert.equal(result.body.matches[0].id, 'warm');
  assert.equal(requests[0].options.temperature, 0);
  assert.equal(requests[0].format.type, 'object');
  const context = JSON.parse(requests[0].messages[1].content);
  assert.equal(context.musicRequirements, '突出亲情');
  assert.deepEqual(context.customKeywords, ['温暖']);
  assert.ok(context.libraryVocabulary.emotions.includes('温暖'));
});
