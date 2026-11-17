import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTargetedJson } from '../app/shared/targeted-json.mjs';
import { hasIncompleteMusic } from '../app/shared/batch-results.mjs';

const value={episodes:[{id:'E1',segments:[{id:'segment-1',matches:[{ref:'M1',evidenceLine:2,reason:'紧张,} 节奏与剧情相呼应，保留引用 "音乐"。'}]}]}]};
const json=JSON.stringify(value);
test('complete JSON, fenced/prose JSON and one extra JSON encoding retain exact content',()=>{
  for(const reply of [json,'\uFEFF'+json,'```json\n'+json+'\n```','结果如下：\n'+json+'\n以上为配乐结果。',JSON.stringify(json)])assert.deepEqual(parseTargetedJson(reply),value);
});
test('format-only cleanup handles trailing delimiters but preserves comma/braces inside strings',()=>{
  assert.deepEqual(parseTargetedJson(json.slice(0,-1)+',}'),value);
  assert.deepEqual(parseTargetedJson('{"episodes":[{"id":"E1",},],}'),{episodes:[{id:'E1'}]});
});
test('raw control characters inside values are escaped without dropping the text',()=>{
  assert.deepEqual(parseTargetedJson('{"episodes":[],"reason":"第一行\n第二行\t音乐"}'),{episodes:[],reason:'第一行\n第二行\t音乐'});
});
test('ambiguous answers, truncation and missing syntax cannot invent recommendations',()=>{
  for(const text of [json+json,json+' {"episodes":[',json.slice(0,-1),'{"episodes": ["E1" "E2"]}',"{'episodes':[]}",'not JSON'])assert.throws(()=>parseTargetedJson(text));
});

test('Flash echoed evidence accepts only a stray quote after a bare integer line property',()=>{
  const expected={episodes:[{id:'E12',segments:[{id:'segment-1',evidence:[{line:72,text:'保留原文与标点。'},{line:74,text:''}],matches:[{ref:'M1',evidenceLine:72,reason:'曲名中的希望对应角色收到消息后的欣慰。'}]}]}]};
  const raw=JSON.stringify(expected).replace(/"line":(\d+)/g,'"line":$1"');
  for(const source of [raw,'结果如下：\n'+raw+'\n结束。','```json\n'+raw+'\n```',JSON.stringify(raw)])assert.deepEqual(parseTargetedJson(source),expected);
  assert.deepEqual(parseTargetedJson('{"line" : 72 \n" , "episodes":[],}'),{line:72,episodes:[]});
  assert.deepEqual(parseTargetedJson('{"episodes":[],"line":0"}'),{episodes:[],line:0});
});

test('line quote repair preserves quoted numbers, escaped JSON text and valid selection fields',()=>{
  const expected={episodes:[],line:'72',reason:'原样保留：{"line":72", "evidenceLine":9"}；反斜杠 \\ 与引号 "。',other:{line:8},evidenceLine:'2',id:12,ref:'M1'};
  const raw=JSON.stringify(expected).replace('"line":8','"line":8"');
  assert.deepEqual(parseTargetedJson(raw),expected);
});

test('line quote cleanup never guesses identifiers, selection evidence, missing delimiters or truncated output',()=>{
  for(const bad of [
    '{"episodes":[],"ref":12"}', '{"episodes":[],"evidenceLine":72"}',
    '{"episodes":[],"line":01"}', '{"episodes":[],"line":-1"}',
    '{"episodes":[],"line":7.2"}', '{"episodes":[],"line":7e2"}',
    '{"episodes":[],"line":72"text"}', '{"episodes":[],"line":72" "text":"x"}',
    '{"episodes":[],"line":72",', '{"episodes":[],"line":72"}{"episodes":[]}',
  ])assert.throws(()=>parseTargetedJson(bad),bad);
});
test('old and new failed-selection records show incomplete, legitimate no-match stays distinct',()=>{
  assert.equal(hasIncompleteMusic({segments:[{matchStatus:'no-match',noMatchReason:'模型未返回完整 JSON'}]}),true);
  assert.equal(hasIncompleteMusic({segments:[{matchStatus:'invalid'}]}),true);
  assert.equal(hasIncompleteMusic({segments:[{matchStatus:'no-match',noMatchReason:'没有足够合适曲目。'}]}),false);
});
