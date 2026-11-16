import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../app/shared/api-service.mjs';
import { nextBatchGroup, createBatchAnalysisQueue } from '../app/shared/batch-analysis.mjs';
import { needsMusicSupplement, exportBatchResults } from '../app/shared/batch-results.mjs';

const provider = {id:'ds', protocol:'deepseek', apiKey:'offline-test-key', models:['deepseek-flash']};
const tracks = Array.from({length:36}, (_,i)=>({id:`t-${i}`,libraryId:'lib-a',title:`温暖亲情 ${String.fromCharCode(65+i)}`,relativePath:`温暖/钢琴/${i}.wav`}));
tracks.push({id:'root',libraryId:'lib-b',title:'温暖亲情 希望',relativePath:'温暖亲情 希望.wav'});
const episode = n => ({id:`ep-${n}`,episodeNumber:n,title:`第${n}集`,script:'机场与办公室\n母亲在电话中宣告研发成功。\n儿子得知救父有了希望。\n母亲立刻赶往登机口。'});
const input = (count=4) => ({provider,model:'deepseek-flash',analysisMode:'targeted',segmented:true,segmentCount:6,episodes:Array.from({length:count},(_,i)=>episode(i+1)),tracks});
const reason = '曲名中的温暖亲情契合通话中得知救父有希望的情绪。';
function planning(payload) {
  return {episodes:payload.episodes.map(e=>({id:e.id,summary:'母子通话交流救父的希望。',keywords:['温暖','亲情'],segments:[{title:'救父希望',startLine:1,summary:'母子通过电话交流救父希望，母亲随即赶往登机口。',keywords:['温暖','亲情'],evidenceLine:2,preferredFolders:[Object.keys(payload.folders||{})[0]].filter(Boolean)}]}))};
}
function selecting(payload) {
  const selected=[];
  return {episodes:payload.episodes.map(e=>({id:e.id,segments:e.segments.map(s=>{
    const blocked=new Set(selected.filter(x=>Math.abs(x.episodeNumber-e.episodeNumber)>0&&Math.abs(x.episodeNumber-e.episodeNumber)<=2).flatMap(x=>x.refs));
    const refs=(s.candidateRefs||s.candidates?.map(t=>t.ref)||[]).filter(ref=>!blocked.has(ref)).slice(0,s.needed||3);
    selected.push({episodeNumber:e.episodeNumber,refs});
    return {id:s.id,matches:refs.map(ref=>({ref,evidenceLine:s.evidence?.find(e=>e.text.includes('母亲在电话'))?.line||s.evidence?.[0]?.line||2,reason}))};
  })}))};
}
function service(mutate=()=>{}, calls=[]) {
  return createApiService(async(_url,opts)=>{
    const request=JSON.parse(opts.body), payload=JSON.parse(request.messages[1].content);
    calls.push({request,payload});
    const data=payload.phase==='music'?selecting(payload):planning(payload);
    const override=mutate(data,payload,calls.length);
    if(override instanceof Error) throw override;
    return Response.json({model:'deepseek-flash',usage:{prompt_tokens:100,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100,completion_tokens:30},choices:[{message:{content:override??JSON.stringify(data)},finish_reason:'stop'}]});
  });
}
const run = async(body,mutate,calls=[]) => (await service(mutate,calls)('/api/script/batch-library-match',body)).body;

test('repro: supplement must reject a real track with evidence outside the scene',async()=>{
  const body=input(1), source=episode(1);
  const api=createApiService(async(_url,opts)=>{
    const p=JSON.parse(JSON.parse(opts.body).messages[1].content),s=p.episodes[0].segments[0];
    const ref=s.candidateRefs?.[0]||s.candidates[0].ref;
    return Response.json({choices:[{message:{content:JSON.stringify({episodes:[{id:p.episodes[0].id,segments:[{id:s.id,matches:[{ref,evidenceLine:999,reason}]}]}]})},finish_reason:'stop'}]});
  });
  const first=await run(body,(d,p)=>{if(p.phase==='music')d.episodes[0].segments[0].matches=[];});
  const previous={id:source.id,...first.episodes[0].value};
  const result=(await api('/api/script/batch-library-match',{...body,operation:'supplement',previousEpisodes:[previous]})).body;
  assert.equal(result.episodes[0].value.matches.length,0,'out-of-scene evidence must never be accepted');
  assert.match(result.episodes[0].value.segments[0].rejectedRecommendations[0].error,/证据/);
});

test('targeted mode runs two stages with three grounded alternatives and real IDs',async()=>{
  const calls=[], result=await run(input(),undefined,calls);
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(c=>c.payload.phase),['segments','music']);
  assert.ok(calls.every(c=>c.request.thinking?.type==='disabled'));
  assert.ok(!calls[0].payload.catalog,'segmentation does not carry track catalog');
  assert.ok(calls[1].payload.catalog.some(t=>t.title===tracks.at(-1).title),'untagged root tracks participate');
  assert.ok(!calls[1].payload.episodes[0].script,'selection does not resend full script');
  for(const e of result.episodes){
    assert.equal(e.value.recommendationTarget,3);
    assert.equal(e.value.matches.length,3);
    assert.ok(e.value.matches.every(m=>tracks.some(t=>t.id===m.id)&&m.evidenceLine===2&&m.evidenceQuote===episode(1).script.split('\n')[1]));
  }
  assert.equal(result.usage.calls.length,2);
  assert.equal(result.usage.promptTokens,200);
  assert.ok(!JSON.stringify(result).includes(provider.apiKey));
});

test('targeted batching and queue preserve the explicit trial mode',async()=>{
  const settings={analyzerKey:'ds::deepseek-flash',subtitleLanguage:'zh',analysisMode:'targeted',segmented:true,segmentCount:6};
  const tasks=input(20).episodes.map(e=>({...e,projectId:'p',status:'queued',settings}));
  assert.equal(nextBatchGroup(tasks).length,20);
  let stored;
  const queue=createBatchAnalysisQueue({load:async()=>null,save:async value=>{stored=value;},analyze:async()=>[]});
  await queue.initialize();await queue.import([episode(1)],settings);
  assert.equal(stored.tasks[0].settings.analysisMode,'targeted');
});

test('invalid evidence or unknown ref only removes that recommendation, then supplement keeps accepted items',async()=>{
  for(const corruption of [m=>{m.evidenceLine=99;},m=>{m.ref='invented';}]){
    const body=input(1), result=await run(body,(d,p)=>{if(p.phase==='music')corruption(d.episodes[0].segments[0].matches[1]);});
    const original=result.episodes[0].value;
    assert.equal(original.matches.length,2);assert.equal(original.segments[0].missingCount,1);
    const calls=[],fixed=await run({...body,operation:'supplement',previousEpisodes:result.episodes.map(e=>({id:e.id,...e.value}))},undefined,calls);
    assert.equal(calls.length,1);assert.equal(calls[0].payload.phase,'music');
    assert.equal(calls[0].payload.episodes[0].segments[0].needed,1);
    assert.equal(fixed.episodes[0].value.matches.length,3);
    for(const kept of original.matches)assert.deepEqual(fixed.episodes[0].value.matches.find(m=>m.id===kept.id),kept);
  }
});

test('supplement applies the same evidence validation and cannot turn invalid evidence into success',async()=>{
  const body=input(1),first=await run(body,(d,p)=>{if(p.phase==='music')d.episodes[0].segments[0].matches=[];});
  const result=await run({...body,operation:'supplement',previousEpisodes:first.episodes.map(e=>({id:e.id,...e.value}))},(d,p)=>{if(p.phase==='music')for(const m of d.episodes[0].segments[0].matches)m.evidenceLine=999;});
  assert.equal(result.episodes[0].value.matches.length,0);
  assert.equal(result.episodes[0].value.segments[0].missingCount,3);
});

test('all three choices obey distance one/two, but distance three and same episode reuse are allowed',async()=>{
  const body=input(),result=await run(body,(d,p)=>{
    if(p.phase==='music')for(const e of d.episodes){const s=p.episodes.find(x=>x.id===e.id).segments[0];e.segments[0].matches=s.candidateRefs.slice(0,3).map(ref=>({ref,evidenceLine:2,reason}));}
  });
  assert.equal(result.episodes[0].value.matches.length,3);
  assert.equal(result.episodes[1].value.matches.length,0);
  assert.equal(result.episodes[2].value.matches.length,0);
  assert.equal(result.episodes[3].value.matches.length,3);
  const same=await run(input(1),(d,p)=>{
    if(p.phase==='segments')d.episodes[0].segments.push({...d.episodes[0].segments[0],title:'赶往登机口',startLine:3,evidenceLine:3});
  });
  assert.equal(same.episodes[0].value.segments[0].matches.length,3);
  assert.equal(same.episodes[0].value.segments[1].matches.length,3);
});

test('malformed selection saves segmentation and existing choices without automatically retrying',async()=>{
  const calls=[],result=await run(input(1),(_d,p)=>p.phase==='music'?'TRUNCATED':undefined,calls);
  assert.equal(calls.length,2);assert.equal(result.episodes[0].value.matches.length,0);
  assert.ok(result.episodes[0].value.analysis.summary);
  assert.match(result.episodes[0].value.segments[0].noMatchReason,/JSON|完整/);
});

test('invalid segmentation stops before music calls; export reports three-choice shortfall',async()=>{
  const calls=[];
  await assert.rejects(run(input(1),(d,p)=>{if(p.phase==='segments')d.episodes[0].segments[0].startLine=2;},calls));
  assert.equal(calls.length,1);
  const result=await run(input(1),(d,p)=>{if(p.phase==='music')d.episodes[0].segments[0].matches.pop();});
  const task={...episode(1),status:'complete',settings:{analysisMode:'targeted'},result:result.episodes[0].value,usageHistory:[result.usage]};
  assert.equal(needsMusicSupplement(task),true);
  const exported=exportBatchResults('离线测试',[task]);
  assert.match(exported.markdown,/缺.*1|1.*缺/);
  assert.equal(JSON.parse(exported.json).episodes[0].result.recommendationTarget,3);
});

test('one missing episode in selection does not discard other valid episodes',async()=>{
  const result=await run(input(2),(d,p)=>{if(p.phase==='music')d.episodes.pop();});
  assert.equal(result.episodes[0].value.matches.length,3);
  assert.equal(result.episodes[1].value.matches.length,0);
});

test('same-name aliases cannot fill alternatives, and outside preferred folders remain available',async()=>{
  const body=input(1);
  body.tracks=[{id:'a',title:'温暖亲情',relativePath:'温暖/a.wav',libraryId:'one'},{id:'b',title:' 温暖亲情 ',relativePath:'其他/a.wav',libraryId:'two'},{id:'c',title:'温暖希望',relativePath:'温暖希望.wav',libraryId:'two'}];
  const result=await run(body,(d,p)=>{if(p.phase==='music')d.episodes[0].segments[0].matches=p.catalog.map(t=>({ref:t.ref,evidenceLine:2,reason}));});
  const chosen=result.episodes[0].value.matches;
  assert.equal(chosen.length,2);assert.equal(new Set(chosen.map(m=>m.title.trim())).size,2);
  assert.ok(chosen.some(m=>m.id==='c'));
  assert.equal(chosen.find(m=>m.id==='c').expanded,true);
  assert.equal(chosen.find(m=>m.id==='c').expansionReason,reason);
  assert.ok(chosen.every(m=>m.libraryId));
});

test('supplement checks future neighbors and repairs conflicts already present in saved results',async()=>{
  const body=input(3),first=await run(body),previous=first.episodes.map(e=>({id:e.id,...structuredClone(e.value)}));
  previous[1].segments[0].matches=[];
  const savedThird=structuredClone(previous[2].segments[0].matches);
  const fixed=await run({...body,operation:'supplement',previousEpisodes:previous});
  assert.equal(fixed.episodes[1].value.matches.length,3);
  assert.deepEqual(fixed.episodes[2].value.matches,savedThird);
  const conflict=first.episodes.map(e=>({id:e.id,...structuredClone(e.value)}));
  conflict[2].segments[0].matches=structuredClone(conflict[0].segments[0].matches);
  const repaired=await run({...body,operation:'supplement',previousEpisodes:conflict});
  assert.equal(repaired.episodes[2].value.matches.length,3);
  assert.ok(repaired.episodes[2].value.matches.every(m=>!repaired.episodes[0].value.matches.some(x=>x.id===m.id)));
});

test('evidence in the scene but absent from the transmitted excerpt is rejected',async()=>{
  const body=input(1);body.episodes[0].script=Array.from({length:100},(_,i)=>`第${i+1}行母亲赶路，儿子在电话里等待。`).join('\n');
  const result=await run(body,(d,p)=>{if(p.phase==='music'){const shown=new Set(p.episodes[0].segments[0].evidence.map(x=>x.line));const omitted=Array.from({length:100},(_,i)=>i+1).find(n=>!shown.has(n));for(const m of d.episodes[0].segments[0].matches)m.evidenceLine=omitted;}});
  assert.equal(result.episodes[0].value.matches.length,0);
});

test('changed script invalidates saved evidence and a failed supplement preserves confirmed recommendations',async()=>{
  const body=input(1),first=await run(body),previous=first.episodes.map(e=>({id:e.id,...e.value}));
  const changed=structuredClone(body);changed.episodes[0].script+='\n新的剧情改变了上下文。';
  // A changed script also requires newly validated boundaries; old boundaries cannot be silently reused.
  await assert.rejects(run({...changed,operation:'supplement',previousEpisodes:previous}));
  const partial=await run(body,(d,p)=>{if(p.phase==='music')d.episodes[0].segments[0].matches.pop();});
  const saved=structuredClone(partial.episodes[0].value.matches),calls=[];
  const failed=await run({...body,operation:'supplement',previousEpisodes:partial.episodes.map(e=>({id:e.id,...e.value}))},()=>new Error('offline simulated service failure'),calls);
  assert.equal(calls.length,1);assert.deepEqual(failed.episodes[0].value.matches,saved);
});

test('whole-episode mode and empty libraries retain valid analysis with explicit shortfalls',async()=>{
  const body={...input(1),segmented:false},whole=await run(body);
  assert.equal(whole.episodes[0].value.matches.length,3);
  assert.equal(whole.episodes[0].value.segments,undefined);
  const calls=[],empty=await run({...input(1),tracks:[]},undefined,calls);
  assert.equal(calls.length,1);assert.equal(empty.episodes[0].value.segments[0].missingCount,3);
});

test('adding an unrelated library track preserves all still-valid confirmed choices',async()=>{
  const body=input(1),first=await run(body),calls=[];
  const next={...body,tracks:[...body.tracks,{id:'new',title:'无关战斗音乐',relativePath:'动作/new.wav'}],operation:'supplement',previousEpisodes:first.episodes.map(e=>({id:e.id,...e.value}))};
  const result=await run(next,(d,p)=>{if(p.phase==='music')d.episodes[0].segments[0].matches=[];},calls);
  assert.deepEqual(result.episodes[0].value.matches,first.episodes[0].value.matches);
  assert.equal(calls.length,0);
});

test('preferred directory and root retrieval cannot be crowded out by an eighty-track global shortlist',async()=>{
  const {targetedCandidates}=await import('../app/shared/targeted-batch-music.mjs');
  const many=Array.from({length:120},(_,i)=>({id:`x-${i}`,title:`温暖亲情 希望钢琴 ${String.fromCharCode(0x4e00+i)}`,relativePath:`其他/${i}.wav`}));
  const catalog=[...many,{id:'preferred',title:'Calm',relativePath:'首选/Calm.wav'},{id:'root-track',title:'温暖柔和',relativePath:'温暖柔和.wav'}];
  const found=targetedCandidates(catalog,{keywords:['温暖','亲情','希望','钢琴'],preferredFolders:['F1']},new Map([['首选','F1'],['其他','F2'],['未分类根目录','F3']]),new Set());
  assert.ok(found.some(t=>t.id==='preferred'));assert.ok(found.some(t=>t.id==='root-track'));
});

test('a future neighboring track missing from the current library still blocks its normalized name',async()=>{
  const body={...input(1),tracks:[{id:'new-id',title:' 同名曲目 ',relativePath:'新库/同名曲目.wav'}],recentEpisodes:[{episodeNumber:2,trackIds:['removed-id'],trackNames:['同名曲目']}]};
  const result=await run(body);
  assert.equal(result.episodes[0].value.matches.length,0);
});

test('supplement refuses an edited script even when its line count has not changed',async()=>{
  const body=input(1),first=await run(body),calls=[];
  const edited=structuredClone(body);edited.episodes[0].script=edited.episodes[0].script.replace('在电话中','当面');
  await assert.rejects(run({...edited,operation:'supplement',previousEpisodes:first.episodes.map(e=>({id:e.id,...e.value}))},undefined,calls),/剧本.*变化|重新分析/);
  assert.equal(calls.length,0);
});

test('a malformed segment list in one episode does not discard another valid episode',async()=>{
  const result=await run(input(2),(d,p)=>{if(p.phase==='music')d.episodes[0].segments='invalid';});
  assert.equal(result.episodes[0].value.matches.length,0);
  assert.equal(result.episodes[1].value.matches.length,3);
});

test('renamed or removed music invalidates only that saved choice',async()=>{
  for(const action of ['rename','remove']){
    const body=input(1),first=await run(body),before=first.episodes[0].value.matches,changed=structuredClone(body);
    if(action==='rename')changed.tracks.find(t=>t.id===before[0].id).title='温暖与希望新版';
    else changed.tracks=changed.tracks.filter(t=>t.id!==before[0].id);
    const calls=[],after=await run({...changed,operation:'supplement',previousEpisodes:first.episodes.map(e=>({id:e.id,...e.value}))},undefined,calls);
    assert.equal(calls.length,1);assert.equal(calls[0].payload.episodes[0].segments[0].needed,1);
    assert.equal(after.episodes[0].value.matches.length,3);
    for(const kept of before.slice(1))assert.deepEqual(after.episodes[0].value.matches.find(m=>m.id===kept.id),kept);
  }
});

test('a failed transport is recorded with unknown usage rather than a misleading partial cost total',async()=>{
  const result=await run(input(1),(_d,p)=>p.phase==='music'?new Error('offline connection lost'):undefined);
  assert.equal(result.usage.calls.length,2);
  assert.equal(result.usage.calls[1].outcome,'request-failed');
  assert.equal(result.usage.calls[1].promptTokens,null);
  assert.equal(result.usage.estimatedCny,null);
  assert.ok(result.episodes[0].value.analysis.summary);
});

test('finish_reason length retains segmentation and usage without retrying selection',async()=>{
  let calls=0;
  const api=createApiService(async(_url,opts)=>{
    calls++;const payload=JSON.parse(JSON.parse(opts.body).messages[1].content),select=payload.phase==='music';
    return Response.json({model:'deepseek-flash',usage:{prompt_tokens:100,completion_tokens:30},choices:[{message:{content:JSON.stringify(select?selecting(payload):planning(payload))},finish_reason:select?'length':'stop'}]});
  });
  const result=(await api('/api/script/batch-library-match',input(1))).body;
  assert.equal(calls,2);assert.equal(result.usage.calls[1].finishReason,'length');
  assert.equal(result.episodes[0].value.matches.length,0);assert.ok(result.episodes[0].value.analysis.summary);
  assert.match(result.episodes[0].value.segments[0].noMatchReason,/长度上限/);
});

test('queue forwards neighbor titles and cancellation preserves the previously saved result',async()=>{
  const body=input(2),first=await run(body);
  const settings={analyzerKey:'ds::deepseek-flash',analysisMode:'targeted',subtitleLanguage:'zh',segmented:true,segmentCount:6};
  const tasks=body.episodes.map(e=>({...e,projectId:'p',status:'complete',settings,result:first.episodes.find(x=>x.id===e.id).value}));
  const original=structuredClone(tasks[0].result);
  let entered,forwarded,stored;
  const started=new Promise(resolve=>{entered=resolve;});
  const queue=createBatchAnalysisQueue({load:async()=>({version:2,projects:[{id:'p',name:'离线测试'}],tasks,activeProjectId:'p'}),save:async value=>{stored=structuredClone(value);},analyze:async(_group,signal,neighbors)=>{
    forwarded=neighbors;entered();
    await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  }});
  await queue.initialize();await queue.supplement(tasks[0].id);
  const running=queue.start([tasks[0].id]);await started;queue.pause();await running;
  assert.deepEqual(forwarded[0].trackNames,[...new Set(tasks[1].result.matches.map(m=>m.title))]);
  assert.deepEqual(stored.tasks[0].result,original);assert.equal(stored.tasks[0].status,'paused');
});
