import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiService} from '../app/shared/api-service.mjs';
import {score} from './script-test-fixtures.mjs';

const input={script:'机场发生追逐。\n甲：快跑！\n医院获救。\n乙：终于安全了。',title:'第1集',hint:'',segmented:true,segmentCount:3,durationSeconds:90};
const plan={segments:[{title:'追逐',startLine:1,endLine:2,summary:'机场追逐，紧张急迫。',keywords:['紧张'],score:{...score,style:'Melancholic piano, no vocals'}},{title:'获救',startLine:3,endLine:4,summary:'终于获救，温暖释然。',keywords:['温暖'],score}]};
const json=JSON.stringify(plan);
const damaged=json.replace('"startLine"','"start\nLine"').replace('"title"','"\ntitle"').replace('机场追逐','机场\r\n追逐').replace('Melancholic','Melanch\nolic').replace('"structure"','"structure\n"');
const provider=protocol=>({id:'offline',protocol,baseUrl:'https://offline.invalid/v1',apiKey:'offline-fixture'});
const reply=(protocol,text,finishReason='stop')=>Response.json(protocol==='gemini'?{candidates:[{content:{parts:[{text}]},finishReason}]}:{choices:[{message:{content:text},finish_reason:finishReason}]});

for(const protocol of ['gemini','custom','openai']){
  test(`${protocol} Gemini removes the observed illegal string linebreaks before requesting paid correction`,async()=>{
    let calls=0;
    const api=createApiService(async()=>{calls++;return reply(protocol,damaged);});
    const response=await api('/api/script/score',{...input,provider:provider(protocol),model:'gemini-3.8-flash-thinking-high'});
    assert.equal(calls,1);assert.equal(response.body.segments.length,2);
    assert.equal(response.body.segments[0].title,'追逐');
    assert.equal(response.body.segments[0].summary,plan.segments[0].summary);
    assert.equal(response.body.segments[0].score.style,plan.segments[0].score.style);
    assert.equal(response.body.segments[0].startLine,1);
  });
}

test('fences, intentional escaped newlines and escaped quotes survive linebreak repair',async()=>{
  const content=JSON.stringify(plan).replace('Melancholic piano, no vocals','Melancholic \\"piano\\",\\nno vocals');
  const api=createApiService(async()=>reply('custom','```json\n'+content.replace('"endLine"','"end\r\nLine"')+'\n```'));
  const response=await api('/api/script/score',{...input,provider:provider('custom'),model:'gemini-3.8-flash-thinking-high'});
  assert.equal(response.body.segments[0].score.style,'Melancholic "piano",\nno vocals');
});

test('repair does not fill missing fields, close a truncated document or accept overlapping lines',async()=>{
  for(const text of [damaged.slice(0,-2),damaged.replace('"endLine":2','"endLine":3'),damaged.replace('"score":','"missingScore":')]){
    let calls=0;
    const api=createApiService(async()=>{calls++;return reply('custom',text);});
    await assert.rejects(api('/api/script/score',{...input,provider:provider('custom'),model:'gemini-3.8-flash-thinking-high'}),/未提交 Suno/);
    assert.equal(calls,2);
  }
});

test('a token-limit finish remains rejected even if the repaired JSON is complete',async()=>{
  const api=createApiService(async()=>reply('custom',damaged,'length'));
  await assert.rejects(api('/api/script/score',{...input,provider:provider('custom'),model:'gemini-3.8-flash-thinking-high'}),/截断.*未提交 Suno/);
});
