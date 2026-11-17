import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
let states=[],cursor=0,effects=[];
const calls=[];
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.blackObsidian={voiceAction:async(action)=>{calls.push(action);return{runtimeReady:false,modelReady:false,results:[],progress:{}}},onVoiceProgress:()=>()=>{}};
globalThis.i={createElement:(type,props,...children)=>({type,props:props||{},children}),useState(initial){const at=cursor++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return[states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value}]},useRef:()=>({current:0}),useEffect(fn){effects.push(fn)}};
const bundle=await build({entryPoints:['app/src/VoiceStudio.jsx'],bundle:true,write:false,format:'esm',jsxFactory:'i.createElement',jsxFragment:'i.Fragment'});
const {VoiceStudio}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const render=()=>{cursor=0;effects=[];return VoiceStudio({active:true})};
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.children)]:[];
const txt=x=>Array.isArray(x)?x.map(txt).join(''):x&&typeof x==='object'?txt(x.children):typeof x==='string'?x:'';
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&txt(n)===label);

test('opening tab requests status only; model installation requires explicit click',async()=>{
  states=[];calls.length=0;let tree=render();for(const effect of effects)effect();await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(calls,['status']);tree=render();assert.equal(button(tree,'生成配音').props.disabled,true);
  await button(tree,'下载安装模型').props.onClick();assert.deepEqual(calls,['status','install','status']);
});
test('cloning requires reference and ultimate mode additionally requires transcript',()=>{
  states=[];render();states[0]={runtimeReady:true,modelReady:true,results:[]};states[2]={...states[2],text:'待配音文本'};
  assert.equal(button(render(),'生成配音').props.disabled,true);
  states[2].reference='E:\\voice.wav';assert.equal(button(render(),'生成配音').props.disabled,false);
  states[2].mode='ultimate';assert.equal(button(render(),'生成配音').props.disabled,true);
  states[2].prompt='参考文字';assert.equal(button(render(),'生成配音').props.disabled,false);
  assert.equal(nodes(render()).some(n=>n.type==='textarea'&&n.props.value===states[2].control),false);
});
test('native worker packaging excludes model weights and auto startup deployment',async()=>{
  const native=await readFile('app/native-host/VoiceStudio.cs','utf8');const build=await readFile('scripts/build-native-host.ps1','utf8');
  assert.match(build,/'worker.py','setup.ps1','model-files.json','NOTICE.txt'/);
  assert.match(native,/if \(action == "status"\) return VoiceStatus\(\)/);
  assert.match(native,/if \(!voiceGate.Wait\(0\)\)/);assert.match(native,/token.Register/);
});
