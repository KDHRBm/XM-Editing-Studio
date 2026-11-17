import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiService} from '../app/shared/api-service.mjs';
import {createBatchAnalysisQueue} from '../app/shared/batch-analysis.mjs';
import {requestScriptAnalysis} from '../app/src/AnalysisRequest.mjs';
import {batchUsageTotals} from '../app/shared/batch-results.mjs';

const provider={id:'ds',protocol:'deepseek',apiKey:'offline-test-key'};
const episode=n=>({id:`12345678-1234-1234-1234-${String(n).padStart(12,'0')}`,episodeNumber:n,title:`第${n}集`,script:'机场大厅\n母亲在电话中宣告研发成功。\n儿子得知救父有了希望。'});
const input=(numbers=[13,14,15])=>({provider,model:'deepseek-flash',analysisMode:'targeted',segmented:true,segmentCount:6,episodes:numbers.map(episode),tracks:[]});
function plan(payload){return {episodes:payload.episodes.map(e=>({id:e.id,summary:`第${e.episodeNumber}集母子通过电话交流救父的希望。`,keywords:['温暖','亲情'],segments:[{title:'救父希望',startLine:1,evidenceLine:2,summary:'母亲通过电话告知研发成功，儿子得知父亲有救而感到欣慰。',keywords:['温暖','亲情'],preferredFolders:[]}]}))};}
function apiFixture(mutate=()=>{}){
  const calls=[];
  const api=createApiService(async(_url,options)=>{
    const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content);calls.push(payload);
    const data=plan(payload);mutate(data,payload);
    return Response.json({model:'deepseek-flash',usage:{prompt_tokens:100,completion_tokens:60},choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}]});
  });
  return {calls,run:async body=>(await api('/api/script/batch-library-match',body)).body};
}

test('targeted requests use actual episode aliases and return local UUIDs after out-of-order replies',async()=>{
  const body=input(),f=apiFixture(data=>data.episodes.reverse());
  const result=await f.run(body);
  assert.deepEqual(f.calls[0].episodes.map(e=>e.id),['E13','E14','E15']);
  assert.ok(!JSON.stringify(f.calls).includes(body.episodes[0].id));
  assert.deepEqual(result.episodes.map(e=>e.id),body.episodes.map(e=>e.id));
  result.episodes.forEach((e,i)=>assert.match(e.value.analysis.summary,new RegExp(`第${13+i}集`)));
});

test('one missing plan preserves the other nineteen episodes without another segmentation call',async()=>{
  const body=input(Array.from({length:20},(_,i)=>i+1));
  const f=apiFixture(data=>data.episodes.splice(12,1));
  const result=await f.run(body);
  assert.equal(result.episodes.length,20);
  assert.equal(result.episodes.filter(e=>e.value).length,19);
  assert.match(result.episodes[12].error,/13.*缺失/);
  assert.equal(result.episodes[12].id,body.episodes[12].id);
  assert.equal(f.calls.length,1);
  assert.match(result.episodes[12].rawAnalysis,/episodes/);
  assert.equal(result.usage.calls.length,1);
});

test('duplicate plan aliases invalidate only that episode, including zero-padded aliases',async()=>{
  const f=apiFixture((data,payload)=>data.episodes.push({...data.episodes[0],id:`e0${payload.episodes[0].episodeNumber}`}));
  const result=await f.run(input());
  assert.match(result.episodes[0].error,/13.*重复/);
  assert.ok(result.episodes[1].value);assert.ok(result.episodes[2].value);
});

test('short aliases tolerate leading zeroes but never attach unknown ids by array position',async()=>{
  const f=apiFixture((data,payload)=>{data.episodes[0].id=`e0${payload.episodes[0].episodeNumber}`;data.episodes[1].id='E999';});
  const result=await f.run(input());
  assert.ok(result.episodes[0].value);assert.match(result.episodes[1].error,/14.*缺失/);assert.ok(result.episodes[2].value);
});

test('conflicting explicit episode number and bad coverage do not erase another valid plan',async()=>{
  const f=apiFixture(data=>{data.episodes[0].episodeNumber=14;data.episodes[1].segments[0].startLine=999;});
  const result=await f.run(input());
  assert.match(result.episodes[0].error,/冲突/);assert.match(result.episodes[1].error,/起点/);assert.ok(result.episodes[2].value);
});

test('all unknown ids stop before music calls with useful counts and the captured reply',async()=>{
  const f=apiFixture(data=>data.episodes.forEach((e,i)=>e.id=`E${90+i}`));
  await assert.rejects(f.run(input()),error=>{
    assert.match(error.message,/缺失.*E13/);assert.match(error.message,/未知.*E90/);
    assert.match(error.rawAnalysis,/E90/);assert.equal(error.usage.calls.length,1);return true;
  });
  assert.equal(f.calls.length,1);
});

test('targeted queue saves valid results and only marks failed identities for retry',async()=>{
  const body=input(),f=apiFixture(data=>data.episodes.splice(1,1));
  let stored;
  const queue=createBatchAnalysisQueue({load:async()=>null,save:async value=>{stored=structuredClone(value);},analyze:async tasks=>{
    const result=await f.run({...body,episodes:tasks});return result.episodes.map(e=>({...e,usage:result.usage}));
  }});
  await queue.initialize();await queue.import(body.episodes,{analyzerKey:'ds::deepseek-flash',subtitleLanguage:'auto',analysisMode:'targeted',segmented:true,segmentCount:6});await queue.start();
  assert.deepEqual(stored.tasks.map(t=>t.status),['complete','error','complete']);
  assert.match(stored.tasks[1].rawAnalysis,/episodes/);
  assert.equal(stored.tasks[0].usageHistory.length,1);
  assert.equal(stored.tasks[1].usageHistory.length,1);
  assert.equal(stored.tasks[2].usageHistory.length,1);
  assert.equal(batchUsageTotals(stored.tasks).calls,1,'shared usage is not multiplied by episode count');
});

test('model reply survives the actual renderer request and queue error path, once per batch',async()=>{
  const originalFetch=globalThis.fetch;
  const raw=JSON.stringify({episodes:[{id:'wrong-id'}]});
  let stored;
  globalThis.fetch=async()=>Response.json({error:'分段标识缺失',rawAnalysis:raw,usage:{id:'same-call',calls:[{}]}},{status:400});
  try{
    const queue=createBatchAnalysisQueue({load:async()=>null,save:async value=>{stored=structuredClone(value);},analyze:(tasks,signal)=>requestScriptAnalysis('batch-library-match',{...input(),episodes:tasks},signal)});
    await queue.initialize();await queue.import(input().episodes,{analyzerKey:'ds::deepseek-flash',subtitleLanguage:'auto',analysisMode:'targeted'});await queue.start();
    assert.deepEqual(stored.tasks.map(t=>t.status),['error','error','error']);
    assert.equal(stored.tasks.filter(t=>t.rawAnalysis).length,1);assert.equal(stored.tasks[0].rawAnalysis,raw);
    assert.equal(queue.backup().tasks[0].rawAnalysis,raw);
    assert.equal(batchUsageTotals(stored.tasks).calls,1);
  }finally{globalThis.fetch=originalFetch;}
});

test('partial segmentation continues candidate selection only for validated episodes',async()=>{
  const body=input();body.tracks=Array.from({length:12},(_,i)=>({id:`track-${i}`,title:`温暖亲情 ${i}`,relativePath:`钢琴/温暖${i}.wav`}));
  const calls=[];
  const api=createApiService(async(_url,options)=>{
    const payload=JSON.parse(JSON.parse(options.body).messages[1].content);calls.push(payload);
    let data;
    if(payload.phase==='segments'){data=plan(payload);data.episodes.splice(1,1);}
    else data={episodes:[...payload.episodes].reverse().map((e,i)=>({id:e.id,segments:e.segments.map(s=>({id:s.id,matches:[{ref:s.candidateRefs[i],evidenceLine:2,reason:'温暖亲情的曲名契合母子通话得知救父希望。'}]}))}))};
    return Response.json({choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}]});
  });
  const result=(await api('/api/script/batch-library-match',body)).body;
  assert.deepEqual(calls.map(c=>c.phase),['segments','music']);
  assert.deepEqual(calls[1].episodes.map(e=>e.id),['E13','E15']);
  assert.equal(result.episodes[0].value.matches.length,1);assert.match(result.episodes[1].error,/缺失/);assert.equal(result.episodes[2].value.matches.length,1);
  assert.ok(!JSON.stringify(calls).includes(body.episodes[0].id));
});
