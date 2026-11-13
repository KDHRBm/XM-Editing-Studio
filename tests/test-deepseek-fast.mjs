import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../app/shared/api-service.mjs';
import { nextBatchGroup, createBatchAnalysisQueue } from '../app/shared/batch-analysis.mjs';
import { analysisCallUsage, summarizeAnalysisUsage } from '../app/shared/analysis-usage.mjs';

const provider = { id: 'ds', protocol: 'deepseek', apiKey: 'test-only-secret', models: ['deepseek-flash'] };
const episodes = Array.from({length:20},(_,i)=>({id:`ep-${i+1}`,episodeNumber:i+1,title:`第${i+1}集`,script:'第1行\n母女相拥，终于团聚。\n她们流下喜悦的泪水。'}));
const tracks = Array.from({length:12},(_,i)=>({id:`track-${i}`,title:`温馨亲情 ${i}`,relativePath:`温馨/钢琴/温馨亲情 ${i}.mp3`}));
const body = {provider,model:'deepseek-flash',analysisMode:'fast',segmented:true,segmentCount:6,episodes,tracks};
function answer(input) { return {episodes:input.episodes.map((e,i)=>{const choices=input.catalog.filter(t=>!e.musicPool||t.pool===e.musicPool);return {id:e.id,summary:'母女重逢，情绪温暖释然。',keywords:['温馨','亲情'],segments:[{title:'重逢',startLine:1,endLine:3,summary:'母女相拥流下喜悦的泪水。',keywords:['温馨','亲情'],matches:[{ref:choices[i%choices.length].ref,evidenceLine:2,reason:'曲名的温馨亲情对应母女重逢后的喜悦与释然。'}],noMatchReason:''}]};})}; }
test('fast mode jointly analyzes twenty episodes once, keeps real file IDs and records usage',async()=>{
  const calls=[];
  const api=createApiService(async(_url,options)=>{
    const request=JSON.parse(options.body);calls.push(request);
    assert.deepEqual(request.thinking,{type:'disabled'});
    assert.equal(request.response_format.type,'json_object');
    const input=JSON.parse(request.messages[1].content);
    assert.equal(input.episodes.length,20);
    assert.equal(new Set(input.catalog.map(t=>t.ref)).size,input.catalog.length);
    assert.ok(input.catalog.some(t=>input.folders[t.folder]?.includes('温馨')));
    return Response.json({model:'deepseek-flash',usage:{prompt_tokens:1000,prompt_cache_hit_tokens:200,prompt_cache_miss_tokens:800,completion_tokens:100,completion_tokens_details:{reasoning_tokens:0}},choices:[{message:{content:JSON.stringify(answer(input))},finish_reason:'stop'}]});
  });
  const result=(await api('/api/script/batch-library-match',body)).body;
  assert.equal(calls.length,1);assert.equal(result.episodes.length,20);
  assert.ok(result.episodes.every(e=>e.value.matches.length===1 && e.value.matches[0].id.startsWith('track-')));
  assert.match(result.episodes[0].value.matches[0].reason,/母女相拥/);
  assert.equal(result.usage.calls.length,1);assert.equal(result.usage.promptTokens,1000);
  assert.equal(result.usage.completionTokens,100);assert.equal(result.usage.reasoningTokens,0);
  assert.ok(!JSON.stringify(result).includes(provider.apiKey));
});
test('fast mode stops missing episodes and rejects invalid music without paid replay',async()=>{
  for(const [mustFail,corrupt] of [[true,data=>data.episodes.pop()],[false,data=>{data.episodes[0].segments[0].matches[0].ref='UNKNOWN';}],[false,data=>{data.episodes[0].segments[0].matches[0].evidenceLine=999;}]]){
    let calls=0;
    const api=createApiService(async(_url,opts)=>{calls++;const data=answer(JSON.parse(JSON.parse(opts.body).messages[1].content));corrupt(data);return Response.json({choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}]});});
    if(mustFail)await assert.rejects(api('/api/script/batch-library-match',body));
    else {const result=await api('/api/script/batch-library-match',body);assert.equal(result.body.episodes[0].value.matches.length,0);assert.ok(result.body.episodes[0].value.analysis.summary);}
    assert.equal(calls,1);
  }
});
test('fast batching permits twenty episodes, separates old mode and preserves character budget',()=>{
  const settings={analyzerKey:'ds::deepseek-flash',subtitleLanguage:'zh',segmented:true,segmentCount:6,analysisMode:'fast'};
  const tasks=episodes.map(e=>({...e,projectId:'p',status:'queued',settings}));
  assert.equal(nextBatchGroup(tasks).length,20);
  assert.equal(nextBatchGroup([...tasks.slice(0,2),{...tasks[2],settings:{...settings,analysisMode:'standard'}}]).length,2);
  assert.ok(nextBatchGroup(tasks.map(t=>({...t,script:'字'.repeat(10000)}))).length<=6);
});
test('queue saves fast settings and supplement request retains existing analysis',async()=>{
  let stored;const seen=[];
  const queue=createBatchAnalysisQueue({load:async()=>null,save:async d=>{stored=structuredClone(d);},analyze:async tasks=>{seen.push(tasks);return tasks.map(t=>({id:t.id,value:{analysis:{summary:'团聚',keywords:['温馨']},matches:[],analysisMode:'fast'}}));}});
  await queue.initialize();await queue.import(episodes.slice(0,1),{analyzerKey:'ds::deepseek-flash',subtitleLanguage:'zh',analysisMode:'fast'});
  assert.equal(stored.tasks[0].settings.analysisMode,'fast');await queue.start();
  await queue.supplement(stored.tasks[0].id);await queue.start();
  assert.equal(seen[1][0].operation,'supplement');assert.ok(seen[1][0].result.analysis);
});
test('supplement reuses saved sections and retains accepted recommendations without resending full scripts',async()=>{
  let calls=0;
  const previous={id:'ep-1',analysis:{summary:'母女重逢',keywords:['温馨']},segments:[
    {id:'segment-1',title:'重逢',startLine:1,endLine:2,summary:'母女重逢',keywords:['温馨'],matches:[{id:'track-0',reason:'已确认的温馨配乐，保留理由。',keywords:['温馨']}]},
    {id:'segment-2',title:'喜悦',startLine:3,endLine:3,summary:'喜悦泪水',keywords:['温馨'],matches:[]}]};
  const api=createApiService(async(_url,options)=>{
    calls++;const input=JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(input.episodes[0].segments.length,1);
    assert.ok(!input.episodes[0].script);
    const unit=input.episodes[0].segments[0];
    return Response.json({choices:[{message:{content:JSON.stringify({episodes:[{id:'ep-1',segments:[{id:unit.id,matches:[{ref:unit.candidates[0].ref,reason:'温馨情绪对应母女团聚的喜悦。'}],noMatchReason:''}]}]})},finish_reason:'stop'}]});
  });
  const result=(await api('/api/script/batch-library-match',{...body,episodes:episodes.slice(0,1),operation:'supplement',previousEpisodes:[previous]})).body;
  assert.equal(calls,1);assert.equal(result.episodes[0].value.segments[0].matches[0].reason,previous.segments[0].matches[0].reason);
  assert.equal(result.episodes[0].value.segments[1].matches.length,1);
});

test('usage keeps missing counters unknown, recognizes official snapshot names and does not bill reasoning twice',()=>{
  const usage=analysisCallUsage({model:'deepseek-v4.1-flash-1017',usage:{prompt_tokens:1000,prompt_cache_hit_tokens:200,prompt_cache_miss_tokens:800,completion_tokens:100,completion_tokens_details:{reasoning_tokens:30}}},{provider,model:'deepseek-flash',elapsedMs:20,label:'test'});
  assert.equal(usage.estimatedCny?.offPeak,0.001204);
  assert.equal(analysisCallUsage({},{provider,model:'deepseek-flash'}).estimatedCny,null);
  assert.equal(analysisCallUsage({usage:{prompt_tokens:100}},{provider,model:'deepseek-flash'}).completionTokens,null);
  assert.equal(analysisCallUsage({usage:{prompt_tokens:100,prompt_cache_hit_tokens:50,prompt_cache_miss_tokens:50,completion_tokens:10}},{provider:{...provider,protocol:'deepseek-relay'},model:'deepseek-flash'}).estimatedCny,null);
});
test('result export counts shared batch usage once and respects one-track targets',async()=>{
  const {batchUsageTotals,needsMusicSupplement,exportBatchResults}=await import('../app/shared/batch-results.mjs');
  const call=analysisCallUsage({usage:{prompt_tokens:1000,prompt_cache_hit_tokens:200,prompt_cache_miss_tokens:800,completion_tokens:100}},{provider,model:'deepseek-flash',elapsedMs:20,label:'test'});
  const usage=summarizeAnalysisUsage([call],20);
  const tasks=episodes.slice(0,2).map(e=>({...e,status:'complete',settings:{analysisMode:'fast'},usageHistory:[usage],result:{analysis:{summary:'重逢',keywords:['温馨']},recommendationTarget:1,matches:[{id:'track-0',title:'温馨亲情',reason:'温馨音乐对应团聚喜悦'}]}}));
  assert.equal(batchUsageTotals(tasks).calls,1);assert.equal(batchUsageTotals(tasks).promptTokens,1000);
  assert.equal(needsMusicSupplement(tasks[0]),false);
  assert.equal(needsMusicSupplement({...tasks[0],result:{...tasks[0].result,matches:[]}}),true);
  const exported=exportBatchResults('测试',tasks);
  assert.equal(JSON.parse(exported.json).episodes.length,2);assert.match(exported.markdown,/温馨亲情/);assert.match(exported.markdown,/1000/);
  assert.ok(!exported.json.includes('apiKey'));
});

test('fast scenes only need ordered start lines; boundaries derive from the next scene and actual script length',async()=>{
  const api=createApiService(async(_url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content),data=answer(input);
    for(const e of data.episodes){delete e.segments[0].endLine;e.segments[0].matches[0].evidenceLine=2;e.segments.push({...e.segments[0],title:'释然',startLine:3,matches:[{...e.segments[0].matches[0],evidenceLine:3}]});}
    return Response.json({choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}]});
  });
  const result=(await api('/api/script/batch-library-match',body)).body;
  assert.deepEqual(result.episodes[0].value.segments.map(s=>[s.startLine,s.endLine]),[[1,2],[3,3]]);
});

test('a large untagged root directory cannot crowd out named mood folders',async()=>{
  const {fastMusicCatalog}=await import('../app/shared/fast-batch-music.mjs');
  const root=Array.from({length:600},(_,n)=>({id:`root-${n}`,title:`Melody ${String.fromCharCode(65+Math.floor(n/26))}${String.fromCharCode(65+n%26)}`,relativePath:`Melody ${n}.mp3`}));
  const tagged=Array.from({length:100},(_,n)=>({id:`tagged-${n}`,title:`温暖 ${n}`,relativePath:`情绪${n}/温暖 ${n}.wav`}));
  const catalog=fastMusicCatalog({episodes,tracks:[...root,...tagged]});
  assert.equal(tagged.filter(t=>catalog.some(c=>c.id===t.id)).length,100);
  assert.ok(catalog.length<=240);
});

test('supplement candidate pools prevent neighboring episodes from choosing the same track',async()=>{
  const previous=episodes.slice(0,2).map(e=>({id:e.id,analysis:{summary:'母女团聚喜悦',keywords:['温馨']},segments:[{id:'segment-1',title:'重逢',startLine:1,endLine:3,summary:'母女团聚喜悦',keywords:['温馨'],matches:[]}]}));
  let calls=0;
  const api=createApiService(async(_url,options)=>{
    calls++;const input=JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({choices:[{message:{content:JSON.stringify({episodes:input.episodes.map(e=>({id:e.id,segments:e.segments.map(s=>({id:s.id,matches:[{ref:s.candidates[0].ref,reason:'温馨亲情贴合母女重逢的喜悦。'}],noMatchReason:''}))}))})},finish_reason:'stop'}]});
  });
  const result=(await api('/api/script/batch-library-match',{...body,episodes:episodes.slice(0,2),operation:'supplement',previousEpisodes:previous})).body;
  assert.equal(calls,1);assert.ok(result.episodes.every(e=>e.value.matches.length===1));
  assert.notEqual(result.episodes[0].value.matches[0].id,result.episodes[1].value.matches[0].id);
});

test('joint fast analysis gives neighboring similar scenes independent candidates before selection',async()=>{
  let calls=0;
  const api=createApiService(async(_url,options)=>{
    calls++;
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);
    const data=answer(input);
    for(const episode of data.episodes) {
      const source=input.episodes.find(e=>e.id===episode.id);
      const allowed=input.catalog.filter(t=>!source.musicPool || t.pool===source.musicPool);
      assert.ok(allowed.length);
      episode.segments[0].matches[0].ref=allowed[0].ref;
    }
    return Response.json({choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}]});
  });
  const result=(await api('/api/script/batch-library-match',{...body,episodes:episodes.slice(0,2),tracks:tracks.slice(0,3)})).body;
  assert.equal(calls,1);
  assert.equal(result.episodes.filter(e=>e.value.matches.length===1).length,2,'valid model choices must not leave adjacent episodes without music');
  assert.notEqual(result.episodes[0].value.matches[0].id,result.episodes[1].value.matches[0].id);
});

test('same filename aliases stay in one pool and mood folders remain represented in each pool',async()=>{
  const {assignMusicPools}=await import('../app/shared/fast-batch-music.mjs');
  const catalog=Array.from({length:12},(_,i)=>({id:`m${i}`,ref:`M${i}`,title:`情绪配乐${i}`,tags:i<6?'亲情':'战斗'}));
  const grouped=assignMusicPools([...catalog,{id:'alias',ref:'M12',title:' 情绪配乐0 ',tags:'另一个目录'}]);
  assert.equal(grouped[0].pool,grouped.at(-1).pool);
  for(const pool of ['A','B','C'])for(const tags of ['亲情','战斗'])assert.ok(grouped.some(t=>t.pool===pool&&t.tags===tags));
});

test('one isolated episode retains the whole library even when its episode number is not one',async()=>{
  const api=createApiService(async(_url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(input.catalog.filter(t=>t.pool===input.episodes[0].musicPool).length,1);
    return Response.json({choices:[{message:{content:JSON.stringify(answer(input))},finish_reason:'stop'}]});
  });
  const result=(await api('/api/script/batch-library-match',{...body,episodes:episodes.slice(1,2),tracks:tracks.slice(0,1)})).body;
  assert.equal(result.episodes[0].value.matches.length,1);
});

test('one malformed music reference preserves paid scene analysis and every other accepted selection',async()=>{
  let calls=0;
  const api=createApiService(async(_url,options)=>{
    calls++;const data=answer(JSON.parse(JSON.parse(options.body).messages[1].content));
    data.episodes[0].segments[0].matches[0].ref='UNKNOWN';
    return Response.json({choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}]});
  });
  const result=(await api('/api/script/batch-library-match',body)).body;
  assert.equal(calls,1);assert.equal(result.episodes.length,20);
  assert.equal(result.episodes[0].value.segments[0].matches.length,0);
  assert.match(result.episodes[0].value.segments[0].noMatchReason,/编号/);
  assert.equal(result.episodes.filter(e=>e.value.matches.length).length,19);
});
