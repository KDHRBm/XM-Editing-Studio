// Offline integration replay. All model responses are fixtures; no network transport
// or production credentials are used. This measures code correctness, not AI quality.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createApiService} from '../app/shared/api-service.mjs';
import {exportBatchResults} from '../app/shared/batch-results.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,item,index,all)=>index%2?pairs:[...pairs,[item.replace(/^--/,''),all[index+1]]],[]));
for(const key of ['input','library','response','output'])if(!args[key])throw new Error(`Required --${key}`);
const input=JSON.parse(await fs.readFile(args.input,'utf8'));
const library=JSON.parse(await fs.readFile(args.library,'utf8'));
const saved=JSON.parse(await fs.readFile(args.response,'utf8'));
const raw=JSON.parse(saved.rawAnalysis),byId=new Map(input.episodes.map((e,i)=>[`E${e.episodeNumber}`,raw.episodes.find(r=>r.id===`E${i+1}`)]));
const output=path.resolve(args.output);
await fs.mkdir(output,{recursive:true});
const traces=[],prompts={},seen=[];
let injectFault=true;
const normalized=s=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const start=performance.now();
const api=createApiService(async(_url,options)=>{
  const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content);
  assert.equal(request.model,'deepseek-flash');assert.deepEqual(request.thinking,{type:'disabled'});
  prompts[payload.phase]=request.messages[0].content;
  traces.push({phase:payload.phase,model:request.model,thinking:request.thinking,episodes:payload.episodes.map(e=>e.id),segments:payload.episodes.reduce((n,e)=>n+(e.segments?.length||0),0),candidates:payload.catalog?.length||0,inputCharacters:JSON.stringify(request.messages).length});
  let response;
  if(payload.phase==='segments'){
    response={episodes:payload.episodes.map(e=>{
      const original=byId.get(e.id);assert.ok(original);
      return {id:e.id,summary:original.summary,keywords:original.keywords,segments:original.segments.map(s=>({title:s.title,startLine:s.startLine,summary:s.summary,keywords:s.keywords,
        evidenceLine:s.matches[0].evidenceLine,preferredFolders:Object.entries(payload.folders).filter(([,folder])=>s.keywords.some(word=>folder.includes(word))).slice(0,3).map(([ref])=>ref)}))};
    })};
  }else{
    assert.equal(payload.phase,'music');
    const catalog=new Map(payload.catalog.map(t=>[t.ref,t]));
    response={episodes:payload.episodes.map(e=>({id:e.id,segments:e.segments.map(s=>{
      const blocked=new Set(seen.filter(x=>Math.abs(x.episodeNumber-e.episodeNumber)>=1&&Math.abs(x.episodeNumber-e.episodeNumber)<=2).map(x=>x.name));
      const chosen=new Set(),matches=[];
      for(const ref of s.candidateRefs){
        const track=catalog.get(ref),title=normalized(track.title);
        if(blocked.has(title)||chosen.has(title))continue;
        chosen.add(title);seen.push({episodeNumber:e.episodeNumber,name:title});
        matches.push({ref,evidenceLine:s.evidence[0].line,reason:'离线测试夹具：仅检查曲目及原文证据的传递，不代表实际配乐建议。'});
        if(matches.length>=s.needed)break;
      }
      if(injectFault&&matches.length){matches[0].evidenceLine=999999;injectFault=false;}
      return {id:s.id,matches,noMatchReason:matches.length<s.needed?'离线夹具未选足候选。':''};
    })}))};
  }
  return Response.json({model:'offline-fixture',choices:[{message:{content:JSON.stringify(response)},finish_reason:'stop'}]});
});
const body={...input,analysisMode:'targeted',segmented:true,segmentCount:6,tracks:library.tracks,provider:{id:'offline',protocol:'deepseek',apiKey:'offline-fixture-only'},model:'deepseek-flash'};
const first=(await api('/api/script/batch-library-match',body)).body;
const firstCalls=traces.length;
const accepted=first.episodes.flatMap(e=>e.value.segments.flatMap(s=>s.matches.map(m=>({episode:e.id,segment:s.id,match:m}))));
const initialMissing=first.episodes.reduce((n,e)=>n+e.value.segments.reduce((n,s)=>n+s.missingCount,0),0);
assert.ok(initialMissing>=1,'the injected invalid evidence must cause a shortfall');
seen.length=0;
for(const e of first.episodes)for(const m of e.value.matches)seen.push({episodeNumber:body.episodes.find(s=>s.id===e.id).episodeNumber,name:normalized(m.title)});
const final=(await api('/api/script/batch-library-match',{...body,operation:'supplement',previousEpisodes:first.episodes.map(e=>({id:e.id,...e.value}))})).body;
assert.ok(traces.slice(firstCalls).every(t=>t.phase==='music'),'supplement must not reanalyze scripts');
for(const old of accepted){
  const retained=final.episodes.find(e=>e.id===old.episode).value.segments.find(s=>s.id===old.segment).matches.find(m=>m.id===old.match.id);
  assert.deepEqual(retained,old.match);
}
const known=new Map(library.tracks.map(t=>[t.id,t])),selections=[];
let segments=0,recommendations=0,missing=0;
assert.equal(final.episodes.length,20);
for(const e of final.episodes){
  const source=body.episodes.find(s=>s.id===e.id),lines=source.script.split('\n'),ss=e.value.segments;
  assert.equal(ss[0].startLine,1);assert.equal(ss.at(-1).endLine,lines.length);assert.ok(ss.length<=6);
  for(let i=0;i<ss.length;i++){
    const s=ss[i];if(i)assert.equal(s.startLine,ss[i-1].endLine+1);
    segments++;recommendations+=s.matches.length;missing+=s.missingCount;
    assert.equal(s.matches.length+s.missingCount,3);
    for(const m of s.matches){
      assert.ok(known.has(m.id));assert.equal(m.title,known.get(m.id).title);
      assert.ok(m.evidenceLine>=s.startLine&&m.evidenceLine<=s.endLine);
      assert.equal(m.evidenceQuote,lines[m.evidenceLine-1].trim().slice(0,240));
      selections.push({episode:source.episodeNumber,id:m.id,name:normalized(m.title)});
    }
  }
}
let conflicts=0;
for(let i=0;i<selections.length;i++)for(let j=i+1;j<selections.length;j++){
  const a=selections[i],b=selections[j],gap=Math.abs(a.episode-b.episode);
  if(gap>=1&&gap<=2&&(a.id===b.id||a.name===b.name))conflicts++;
}
assert.equal(conflicts,0);
const tasks=final.episodes.map(e=>({...body.episodes.find(s=>s.id===e.id),status:'complete',settings:{analysisMode:'targeted'},result:e.value,usageHistory:[first.usage,final.usage]}));
const exported=exportBatchResults('离线流程夹具（不是实际配乐建议）',tasks);
const parsed=JSON.parse(exported.json);
parsed.verification={transport:'in-memory fixtures',paidApiRequests:0,semanticQualityEvaluated:false};
const metrics={episodes:20,tracks:known.size,scriptCharacters:body.episodes.reduce((n,e)=>n+e.script.length,0),segments,recommendations,target:segments*3,initialMissing,missing,neighborConflicts:conflicts,preserved:accepted.length,
  simulatedInitialCalls:firstCalls,simulatedSupplementCalls:traces.length-firstCalls,paidApiRequests:0,paidApiCostCny:0,offlineElapsedMs:Math.round(performance.now()-start),liveLatencyMeasured:false,semanticQualityEvaluated:false,
  librarySha256:final.episodes[0].value.inputIdentity.librarySha256};
await fs.writeFile(path.join(output,'离线夹具结果.json'),JSON.stringify(parsed,null,2));
await fs.writeFile(path.join(output,'离线夹具结果.md'),'此文件是离线程序验证夹具，不是模型推荐，不用于实际剪辑。\n\n'+exported.markdown.replace('API 请求：','内存模拟调用（非真实 API）：'));
await fs.writeFile(path.join(output,'断言与统计.json'),JSON.stringify(metrics,null,2));
await fs.writeFile(path.join(output,'模拟调用记录.json'),JSON.stringify(traces,null,2));
await fs.writeFile(path.join(output,'试验提示词.json'),JSON.stringify(prompts,null,2));
console.log(JSON.stringify(metrics,null,2));
