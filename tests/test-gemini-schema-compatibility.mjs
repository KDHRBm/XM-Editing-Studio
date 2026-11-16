import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiService} from '../app/shared/api-service.mjs';
import {score} from './script-test-fixtures.mjs';

const input={script:'机场发生追逐。\n甲：快跑！\n医院获救。\n乙：终于安全了。',title:'第1集',hint:'',segmented:true,segmentCount:3,durationSeconds:90};
const plan={segments:[{title:'追逐',startLine:1,endLine:2,summary:'机场追逐，紧张急迫。',keywords:['紧张'],score},{title:'获救',startLine:3,endLine:4,summary:'终于获救，温暖释然。',keywords:['温暖'],score}]};
const provider=protocol=>({id:'offline-gemini',protocol,baseUrl:'https://offline.invalid/v1',apiKey:'offline-fixture'});
const schemaOf=request=>request.generationConfig?.responseSchema||request.generationConfig?.responseJsonSchema||request.response_format?.json_schema?.schema;
const success=(protocol,text=JSON.stringify(plan))=>Response.json(protocol==='gemini'?{candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]}:{choices:[{message:{content:text},finish_reason:'stop'}]});
const failure=(message,status=400)=>Response.json({error:{message}},{status});
const screenshotError='Invalid JSON payload received. Unknown name "additionalProperties" at \'generation_config.response_schema.properties[0].value.items.properties[2].value.items\': Cannot find field.';
function legacySchemaError(schema){
  if(!schema||typeof schema!=='object')return '';
  if(Object.hasOwn(schema,'additionalProperties'))return screenshotError;
  for(const property of Object.values(schema.properties||{})){const error=legacySchemaError(property);if(error)return error;}
  return schema.items?legacySchemaError(schema.items):'';
}

for(const protocol of ['gemini','openai','custom']){
  test(`${protocol} Gemini works through a legacy response_schema gateway without additionalProperties`,async()=>{
    const requests=[];
    const api=createApiService(async(_url,options)=>{
      const request=JSON.parse(options.body);requests.push(request);
      const schema=schemaOf(request);assert.ok(schema,'Keep supported schema constraints on the first attempt');
      const error=legacySchemaError(schema);
      return error?failure(error):success(protocol);
    });
    const response=await api('/api/script/score',{...input,provider:provider(protocol),model:'gemini-3.8-flash-thinking'});
    assert.equal(response.body.segments.length,2);assert.equal(requests.length,1);
    const schema=schemaOf(requests[0]);
    assert.deepEqual(schema.required,['segments']);
    assert.equal(schema.properties.segments.minItems,2);
    assert.equal(schema.properties.segments.maxItems,3);
    assert.ok(schema.properties.segments.items.required.includes('score'));
    assert.notEqual(requests[0].response_format?.json_schema?.strict,true);
  });

  test(`${protocol} Gemini retries a rejected schema once in JSON mode with the same task`,async()=>{
    const requests=[];
    const api=createApiService(async(_url,options)=>{
      const request=JSON.parse(options.body);requests.push(request);
      if(schemaOf(request))return failure(protocol==='gemini'?'Invalid JSON payload received. Unknown name "responseSchema" at "generation_config": Cannot find field.':'response_format type json_schema is not supported for this model');
      assert.equal(protocol==='gemini'?request.generationConfig.responseMimeType:request.response_format?.type,protocol==='gemini'?'application/json':'json_object');
      return success(protocol);
    });
    const response=await api('/api/script/score',{...input,provider:provider(protocol),model:'gemini-3.8-flash-thinking'});
    assert.equal(response.body.segments.length,2);assert.equal(requests.length,2);
    for(const field of ['contents','systemInstruction','messages','model'])assert.deepEqual(requests[1][field],requests[0][field]);
    assert.equal(requests[1].thinking,undefined);
  });
}

test('schema fallback cannot loop when JSON mode is also rejected',async()=>{
  let calls=0;
  const api=createApiService(async()=>{calls++;return failure('response_format is not supported');});
  await assert.rejects(api('/api/script/score',{...input,provider:provider('custom'),model:'gemini-3.8-flash-thinking'}),/连接失败/);
  assert.equal(calls,2);
});

test('authentication, quota, network and unrelated validation errors do not trigger schema fallback',async()=>{
  for(const [status,message] of [[400,'Invalid API key'],[400,'max_tokens exceeds the limit'],[401,'response_format is not supported'],[403,'Permission denied'],[429,'Rate limit'],[500,'Unknown name responseSchema']]){
    let calls=0;
    const api=createApiService(async()=>{calls++;return failure(message,status);});
    await assert.rejects(api('/api/script/score',{...input,provider:provider('custom'),model:'gemini-3.8-flash-thinking'}),/连接失败/);
    assert.equal(calls,1,`${status}: ${message}`);
  }
  let calls=0;
  const api=createApiService(async()=>{calls++;throw new TypeError('Network error');});
  await assert.rejects(api('/api/script/score',{...input,provider:provider('custom'),model:'gemini-3.8-flash-thinking'}),/无法连接/);
  assert.equal(calls,1);
});

test('JSON fallback still rejects an incomplete plan after one content correction',async()=>{
  const requests=[];
  const api=createApiService(async(_url,options)=>{
    const request=JSON.parse(options.body);requests.push(request);
    if(schemaOf(request))return failure(screenshotError);
    return success('custom',JSON.stringify(score));
  });
  await assert.rejects(api('/api/script/score',{...input,provider:provider('custom'),model:'gemini-3.8-flash-thinking'}),/缺少.*segments.*未提交 Suno/);
  assert.equal(requests.length,4);
  assert.equal(requests.filter(request=>!schemaOf(request)).length,2);
});
