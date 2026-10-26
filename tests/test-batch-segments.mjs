import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBatchMusic } from '../app/shared/batch-music.mjs';
import { batchCandidates } from '../app/shared/batch-candidates.mjs';
import { createBatchAnalysisQueue, nextBatchGroup } from '../app/shared/batch-analysis.mjs';

const episodes = [31,32,33].map(n=>({id:`ep-${n}`,episodeNumber:n,title:`第${n}集`,script:`第${n}集\n[EN] A: Where are you?\n△ 追逐\n[EN] B: Run!`}));
const tracks = [{id:'warm',title:'温暖钢琴'}, {id:'dark',title:'悬疑弦乐'}, {id:'sad',title:'悲伤钢琴'}];
const keywords = input => JSON.stringify({episodes:input.episodes.map(e=>({id:e.id,summary:'剧情与情绪',keywords:['紧张弦乐']}))});
const segmentedKeywords = input => JSON.stringify({episodes:input.episodes.map(e=>({id:e.id,summary:'失散与追逐',keywords:['钢琴','紧张'],segments:[{title:'失散',startLine:1,endLine:2,summary:'悲伤失落',keywords:['melancholic']},{title:'追逐',startLine:3,endLine:4,summary:'紧张追逐',keywords:['紧张弦乐']}]})).reverse()});
const context = messages => JSON.parse(messages[1].content);

test('later episodes get local candidates even when compound model keywords do not occur verbatim in titles', () => {
  const large = [...Array.from({length:120},(_,i)=>({id:`copy-${i}`,title:`悬疑 (${i})`})),...tracks];
  const result = batchCandidates(large,['悲凉的钢琴旋律'],24);
  assert.ok(result.some(track=>track.id==='sad'));
  assert.equal(result.filter(track=>/^copy-/.test(track.id)).length <= 2,true);
  assert.ok(batchCandidates(large,['melancholy'],24).some(track=>track.id==='sad'));
  const fallback = batchCandidates(large,['无法精确检索的组合词'],24);
  assert.ok(fallback.length>0); assert.ok(fallback.every(track=>large.some(local=>local.id===track.id)));
  assert.ok(new Set(result.map(track=>track.id)).size === result.length);
});

test('31 has music, 32/33 empty: one joint review completes both later episodes, keeping the first result', async () => {
  const requests=[];
  const result = await analyzeBatchMusic({episodes,tracks},async messages=>{
    const input=context(messages); requests.push(input);
    if(requests.length===1) return keywords(input);
    if(requests.length===2) return JSON.stringify({episodes:input.episodes.map((episode,index)=>({id:episode.id,matches:index===0?[{id:'dark',reason:'第一集悬疑'}]:[]}))});
    assert.deepEqual(input.episodes.map(e=>e.id),['ep-31','ep-32','ep-33']);
    assert.ok(input.episodes.every(e=>e.candidates.length));
    return JSON.stringify({episodes:input.episodes.map(e=>({id:e.id,matches:[{id:'dark',reason:'同一音乐也适合此集紧张剧情'}]})).reverse()});
  });
  assert.equal(requests.length,3);
  assert.ok(result.episodes.every(e=>e.value.matches[0].id==='dark'));
  assert.equal(result.episodes[0].value.matches[0].reason,'第一集悬疑');
});

test('genuinely unmatched episodes stay explicit and never manufacture recommendations or retry indefinitely', async () => {
  let calls=0;
  const result=await analyzeBatchMusic({episodes,tracks},async messages=>{
    const input=context(messages); if(++calls===1)return keywords(input);
    return JSON.stringify({episodes:input.episodes.map(e=>({id:e.id,matches:[],noMatchReason:'需要喜剧音乐，现有库以悬疑和悲伤为主。'}))});
  });
  assert.equal(calls,3);assert.ok(result.episodes.every(e=>e.value.matches.length===0 && e.value.evaluated>0 && e.value.matchStatus==='no-match' && e.value.noMatchReason.includes('喜剧')));
});

test('multi-episode segments are planned jointly and every segment keeps its own matches and full line coverage', async () => {
  let calls=0;
  const result=await analyzeBatchMusic({episodes,tracks,segmented:true,segmentCount:3},async messages=>{
    const input=context(messages);assert.equal(input.episodes.length,3);
    if(++calls===1){assert.equal(input.episodes[2].numberedScript.at(-1).line,4);assert.equal(input.episodes[0].script,undefined);return segmentedKeywords(input);}
    return JSON.stringify({episodes:input.episodes.map(e=>({id:e.id,segments:e.segments.map(s=>({id:s.id,matches:[{id:s.id==='segment-1'?'sad':'dark',reason:s.summary}]})).reverse()})).reverse()});
  });
  assert.equal(calls,3);assert.deepEqual(result.episodes.map(e=>e.id),episodes.map(e=>e.id));
  for(const {value} of result.episodes){assert.equal(value.segmented,true);assert.equal(value.segments.length,2);assert.equal(value.segments[0].matches[0].id,'sad');assert.equal(value.segments[1].matches[0].id,'dark');assert.equal(value.matches.length,2);assert.equal(value.segments[1].endLine,4);assert.equal(JSON.stringify(value).includes('candidates'),false);}
});

test('empty segment recheck includes only missing sections across episodes and retains successful sections', async () => {
  let calls=0;
  const result=await analyzeBatchMusic({episodes,tracks,segmented:true,segmentCount:3},async messages=>{
    const input=context(messages);if(++calls===1)return segmentedKeywords(input);
    if(calls===2)return JSON.stringify({episodes:input.episodes.map(e=>({id:e.id,segments:e.segments.map((s,index)=>({id:s.id,matches:index===0?[{id:'sad',reason:'已匹配悲伤'}]:[]}))}))});
    assert.equal(input.episodes.length,3);assert.ok(input.episodes.every(e=>e.segments.length===2));
    return JSON.stringify({episodes:input.episodes.map(e=>({id:e.id,segments:e.segments.map(s=>({id:s.id,matches:[{id:s.id==='segment-1'?'sad':'dark',reason:'复核匹配悬疑'}]}))}))});
  });
  assert.equal(calls,3);assert.ok(result.episodes.every(e=>e.value.segments[0].matches[0].reason==='已匹配悲伤' && e.value.segments[1].matches.length===1));
});

test('segmented batches reject missing segments, incomplete story coverage, and nonlocal track IDs', async () => {
  const input={episodes,tracks,segmented:true,segmentCount:3};
  await assert.rejects(analyzeBatchMusic(input,async messages=>{const data=JSON.parse(segmentedKeywords(context(messages)));data.episodes[0].segments[1].startLine=4;return JSON.stringify(data);}),/行号/);
  for(const defect of ['missing','invented']){
    let calls=0;const result=await analyzeBatchMusic(input,async messages=>{
      const data=context(messages);if(++calls===1)return segmentedKeywords(data);
      return JSON.stringify({episodes:data.episodes.map(e=>({id:e.id,segments: defect==='missing'?[]:e.segments.map(s=>({id:s.id,matches:[{id:'invented',reason:'fake'}]}))}))});
    });
    assert.equal(calls,3);assert.ok(result.episodes.every(e=>e.value.segments.every(s=>s.matches.length===0 && s.warning)));
  }
});

test('no library still analyzes each scene once and returns explicit local-library guidance', async()=>{
  let calls=0;const result=await analyzeBatchMusic({episodes,tracks:[],segmented:true,segmentCount:2},async messages=>{calls++;return segmentedKeywords(context(messages));});
  assert.equal(calls,1);assert.ok(result.episodes.every(e=>e.value.segments.every(s=>s.matchStatus==='no-library' && s.noMatchReason.includes('音乐库'))));
});

test('existing whole cards can be requeued as segments; grouping stays by mode and limits total sections',async()=>{
  let data;const queue=createBatchAnalysisQueue({load:async()=>data,save:async value=>{data=structuredClone(value);},analyze:async()=>[]});
  await queue.initialize();await queue.import(episodes,{analyzerKey:'web',subtitleLanguage:'auto'});
  const id=queue.snapshot().tasks[0].id;await queue.retry(id,'gemini',{segmented:true,segmentCount:6});
  assert.equal(data.tasks[0].settings.segmented,true);assert.equal(data.tasks[0].settings.analyzerKey,'gemini');
  assert.equal(nextBatchGroup(data.tasks).length,1);
  const tasks=Array.from({length:20},(_,n)=>({...data.tasks[0],id:String(n),settings:{...data.tasks[0].settings,segmentCount:6}}));
  assert.equal(nextBatchGroup(tasks).length,4);
});
