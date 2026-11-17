import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {installedModelRows, modelBytes, removeLocalProviderModel} from '../app/src/LocalModelManagement.mjs';
let states=[],cursor=0;
globalThis.i={createElement:(type,props,...children)=>({type,props:props||{},children}),useState(initial){const n=cursor++;if(!(n in states))states[n]=initial;return[states[n],value=>{states[n]=value;}];}};
const bundle=await build({entryPoints:['app/src/LocalModelManager.jsx'],bundle:true,write:false,format:'esm',jsxFactory:'i.createElement',jsxFragment:'i.Fragment'});
const {LocalModelManager}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const nodes=tree=>tree&&typeof tree==='object'?[tree,...(tree.children||[]).flat(Infinity).flatMap(nodes)]:[];
const textOf=tree=>typeof tree==='string'?tree:(tree?.children||[]).flat(Infinity).map(textOf).join('');
const model='custom/story:latest';
const state={running:true,runtimeInstalled:true,models:[model],modelDetails:[{name:model,sizeBytes:3000000000,complete:true,parameters:'4B',quantization:'Q4'}],modelStorageBytes:3000000000,modelsPath:'E:/fixture/models',acceleration:{usageState:'gpu',models:[{name:model,vramBytes:2000000000}]}};
const render=props=>{cursor=0;return LocalModelManager({state,busy:'',onAction:async()=>true,...props});};
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&textOf(n)===label);

test('manager shows actual arbitrary tags, disk and memory usage, including offline inventory',()=>{
  states=[];
  const tree=render();
  assert.match(textOf(tree),/custom\/story:latest/);
  assert.match(textOf(tree),/3\.00 GB/);
  assert.match(textOf(tree),/已加载 · 显存 2\.00 GB/);
  assert.equal(button(tree,'释放显存').props.disabled,false);
  const offline=render({state:{...state,running:false,acceleration:{usageState:'stopped',models:[]}}});
  assert.match(textOf(offline),/服务未启动/);
  assert.equal(button(offline,'释放显存').props.disabled,true);
  assert.equal(button(offline,'删除').props.disabled,false,'Offline models remain manageable via an automatically started owned service');
});

test('deleting requires a named confirmation, cancel makes no native request and failed deletion stays visible',async()=>{
  states=[];const calls=[];
  const props={onAction:async(...args)=>{calls.push(args);return false;}};
  button(render(props),'删除').props.onClick();
  let tree=render(props);
  assert.ok(nodes(tree).some(n=>n.props['aria-label']===`确认删除 ${model}`));
  assert.equal(calls.length,0);
  button(tree,'取消').props.onClick();
  assert.equal(button(render(props),'确认删除'),undefined);
  button(render(props),'删除').props.onClick();
  await button(render(props),'确认删除').props.onClick();
  assert.deepEqual(calls, [['delete-model',model,{confirmModel:model}]]);
  assert.ok(button(render(props),'确认删除'),'Failed deletion must not disappear or claim success');
  await button(render({onAction:async()=>true}),'确认删除').props.onClick();
  assert.equal(button(render(),'确认删除'),undefined);
  assert.match(textOf(render()),/已删除，已保存的分析结果保留/);
});

test('active analysis or download disables deletion and unloading; incomplete files cannot be added',()=>{
  for(const props of [{state:{...state,analysisActive:true}},{busy:'pull'}]){
    states=[];const tree=render(props);
    assert.equal(button(tree,'删除').props.disabled,true);assert.equal(button(tree,'释放显存').props.disabled,true);
  }
  states=[];const tree=render({state:{...state,modelDetails:[{...state.modelDetails[0],complete:false}]}});
  assert.match(textOf(tree),/文件不完整/);assert.equal(button(tree,'加入分析').props.disabled,true);
});

test('unload targets one model without deletion and old hosts cannot expose destructive controls',async()=>{
  states=[];const calls=[];
  await button(render({onAction:async(...args)=>{calls.push(args);return true;}}),'释放显存').props.onClick();
  assert.deepEqual(calls,[['unload-model',model,undefined]]);
  assert.match(textOf(render()),/下次分析时自动加载/);
  const tree=render({state:{...state,modelDetails:undefined}});
  assert.equal(button(tree,'删除').props.disabled,true);
  assert.equal(installedModelRows({...state,modelDetails:[{name:'../bad:latest'}]}).length,0);
});

test('removing one managed model preserves cloud connections, other local models and historical input objects',()=>{
  const providers=[{id:'cloud',protocol:'deepseek',models:[model],apiKey:'keep'},{id:'provider-ollama-local',protocol:'ollama',models:[model,'qwen3.5:4b']}];
  const before=structuredClone(providers),next=removeLocalProviderModel(providers,model);
  assert.deepEqual(providers,before);assert.deepEqual(next[0],before[0]);assert.deepEqual(next[1].models,['qwen3.5:4b']);
  assert.equal(modelBytes(-1),'未知');assert.equal(modelBytes(0),'0 B');
});
