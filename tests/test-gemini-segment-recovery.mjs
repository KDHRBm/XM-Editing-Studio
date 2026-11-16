import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../app/shared/api-service.mjs';
import { planSegments, parseSegments, segmentMessages } from '../app/shared/script-segments.mjs';
import { createScriptQueue } from '../app/shared/script-queue.mjs';
import { score } from './script-test-fixtures.mjs';

const input={script:'机场发生追逐。\n甲：快跑！\n医院获救。\n乙：终于安全了。',title:'第1集',hint:'',segmented:true,segmentCount:3,durationSeconds:90};
const plan={segments:[{title:'追逐',startLine:1,endLine:2,summary:'机场追逐，紧张急迫。',keywords:['紧张'],score:{...score,title:'追逐',style:'tense cinematic drums, no vocals'}},{title:'获救',startLine:3,endLine:4,summary:'终于获救，温暖释然。',keywords:['温暖'],score}]};
const provider={id:'gemini-test',protocol:'gemini',apiKey:'offline-fixture'};
const body={...input,provider,model:'gemini-3.8-flash'};
const result=(parts,finishReason='STOP')=>Response.json({candidates:[{content:{parts},finishReason}]});

test('Gemini thinking parts never become a music plan or hide the final valid JSON',async()=>{
  for(const thought of ['推理中的未闭合对象 {',JSON.stringify({...plan,segments:plan.segments.map(s=>({...s,title:'推理草稿'}))})]){
    let calls=0;
    const api=createApiService(async()=>{calls++;return result([{thought:true,text:thought},{text:JSON.stringify(plan)}]);});
    const response=await api('/api/script/score',body);
    assert.equal(calls,1);assert.equal(response.body.segments[0].title,'追逐');
  }
});

test('valid JSON with the wrong shape and empty output have distinct errors',()=>{
  assert.throws(()=>parseSegments(JSON.stringify(score),input,'suno'),/缺少.*segments/);
  assert.throws(()=>parseSegments('',input,'suno'),/空白|未返回/);
  assert.throws(()=>parseSegments('{"segments":[',input,'suno'),/有效 JSON/);
});

test('even parseable truncated responses cannot become ready Suno tasks',async()=>{
  let calls=0;
  await assert.rejects(planSegments(input,'suno',async()=>{calls++;return {text:JSON.stringify(plan),finishReason:'MAX_TOKENS'};}),/截断.*未提交 Suno/);
  assert.equal(calls,2);
});

test('segmented prompts contain a valid outer segments example and send the script only once',()=>{
  const messages=segmentMessages(input,'suno'),payload=JSON.parse(messages[1].content);
  assert.equal(payload.originalScript,undefined);
  assert.equal(payload.numberedScript.map(row=>row.text).join('\n'),input.script);
  assert.equal(payload.targetSeconds,90);
  assert.doesNotMatch(messages[0].content,/为整份剧本设计一首|配乐方案对象/);
  assert.match(messages[0].content,/最外层.*segments/);
});

test('Gemini native and compatible transports constrain the outer segmented result on both attempts',async()=>{
  for(const protocol of ['gemini','openai','custom']){
    const requests=[];
    const api=createApiService(async(_url,options)=>{
      requests.push(JSON.parse(options.body));const text=JSON.stringify(requests.length===1?score:plan);
      return protocol==='gemini'?result([{text}]):Response.json({choices:[{message:{content:text},finish_reason:'stop'}]});
    });
    const response=await api('/api/script/score',{...body,provider:{...provider,protocol,baseUrl:'https://offline.invalid/v1'},model:'gemini-3.8-flash-thinking'});
    assert.equal(response.body.segments.length,2);assert.equal(requests.length,2);
    for(const request of requests){
      const schema=protocol==='gemini'?request.generationConfig.responseJsonSchema:request.response_format?.json_schema?.schema;
      assert.ok(schema?.required.includes('segments'));
      assert.ok(schema.properties.segments.items.required.includes('score'));
    }
  }
});

test('a tagged reasoning draft is excluded for compatible Gemini responses',async()=>{
  let calls=0;
  const api=createApiService(async()=>{calls++;return Response.json({choices:[{message:{content:`<think>${JSON.stringify({...plan,segments:plan.segments.map(s=>({...s,title:'草稿'}))})}</think>\n${JSON.stringify(plan)}`},finish_reason:'stop'}]});});
  const response=await api('/api/script/score',{...body,provider:{...provider,protocol:'openai',baseUrl:'https://offline.invalid/v1'}});
  assert.equal(calls,1);assert.equal(response.body.segments[0].title,'追逐');
});

test('invalid plans stop the queue with zero Suno submissions and repair never loops',async()=>{
  let analysisCalls=0,submissions=0;
  const api=createApiService(async()=>{analysisCalls++;return result([{text:JSON.stringify(score)}]);});
  const config={providerId:provider.id,protocol:'gemini',model:body.model,baseUrl:'https://offline.invalid'};
  const suno={providerId:'suno',protocol:'suno',model:'suno_music',baseUrl:'https://offline.invalid'};
  const queue=createScriptQueue({save:()=>{},getProvider:id=>({...provider,...(id==='suno'?suno:config)}),request:async(url,data)=>{
    if(url==='/api/script/score')return (await api(url,data)).body;
    submissions++;throw new Error('must not submit');
  }});
  queue.add(input,config,suno);queue.start();await queue.tick();await queue.tick();
  assert.equal(analysisCalls,2);assert.equal(submissions,0);
  assert.equal(queue.snapshot().jobs[0].status,'error');
  assert.match(queue.snapshot().jobs[0].error,/缺少.*segments/);
});

test('repair retains numbered original text and does not include a truncated previous response',async()=>{
  const calls=[];
  const parsed=await planSegments(input,'suno',async(messages)=>{calls.push(messages);return calls.length===1?{text:'partial',finishReason:'LENGTH'}:{text:JSON.stringify(plan),finishReason:'STOP'};});
  assert.equal(parsed.length,2);assert.equal(calls.length,2);
  const payload=JSON.parse(calls[1][1].content);
  assert.equal(payload.numberedScript.map(row=>row.text).join('\n'),input.script);
  assert.equal(payload.previousResult,'');
});
