import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({entryPoints:['app/src/QuickRail.jsx'],bundle:true,write:false,format:'esm',jsxFactory:'i.createElement',jsxFragment:'i.Fragment'});
const {QuickRail} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let slots=[],cursor=0,layout={};
globalThis.localStorage={getItem:()=>JSON.stringify(layout)};
globalThis.i={
  createElement:(type,props,...children)=>({type,props:props||{},children}),
  useEffect:()=>{},
  useRef(initial){const index=cursor++;return slots[index]??=( {current:initial} );},
  useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
};
const render=()=>{cursor=0;return QuickRail();};
const nodes=tree=>!tree||typeof tree!=='object'?[]:[tree,...(tree.children||[]).flat(Infinity).flatMap(nodes)];
const textOf=tree=>typeof tree==='string'?tree:(tree?.children||[]).flat(Infinity).map(textOf).join('');
const area=tree=>nodes(tree).find(node=>node.props['aria-label']==='自定义文件夹拖放区域');
const button=(tree,label)=>nodes(tree).find(node=>node.type==='button'&&textOf(node)===label);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const drop=files=>({dataTransfer:{types:['Files'],files},preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}});

test('quick folder drop forwards File objects once, updates list and preserves double-click opening',async()=>{
  slots=[];layout={};let finish,calls=0;const launched=[];
  const files=[{name:'剪映草稿'},{name:'音乐目录'}],folders=files.map((file,n)=>({id:String(n),name:file.name,path:'E:/'+file.name}));
  const state={folders,installs:[],selected:''};
  globalThis.blackObsidian={addQuickFolders:input=>{calls++;assert.deepEqual(input,files);return new Promise(resolve=>{finish=resolve;});},quickLaunch:async(action,value)=>{launched.push([action,value]);return state;}};
  let tree=render();const target=area(tree),event=drop(files);
  target.props.onDragEnter(event);assert.match(area(render()).props.className,/is-dragging/);
  target.props.onDrop(event);target.props.onDrop(event);
  assert.equal(calls,1);assert(event.prevented&&event.stopped);
  assert(button(render(),'正在处理…').props.disabled);
  finish(state);await tick();tree=render();
  assert.match(textOf(tree),/已添加 2 个文件夹/);
  assert.doesNotMatch(area(tree).props.className,/is-dragging/);
  const open=nodes(tree).find(node=>node.props.className==='bos-folder-open');
  await open.props.onDoubleClick();assert.deepEqual(launched,[['openFolder','0']]);
  globalThis.blackObsidian.addQuickFolders=async()=>state;
  area(render()).props.onDrop(drop(files));await tick();
  assert.match(textOf(render()),/无需重复添加/);
});

test('quick folder failed drop preserves list, clears busy state and accepts retry',async()=>{
  slots=[];layout={};let fail=false;
  const state={folders:[{id:'a',name:'草稿',path:'E:/草稿'}],installs:[],selected:''};
  globalThis.blackObsidian={quickLaunch:async()=>state,addQuickFolders:async()=>{if(fail)throw Error('最多设置八个自定义文件夹，本次未添加。');return state;}};
  area(render()).props.onDrop(drop([{}]));await tick();fail=true;
  area(render()).props.onDrop(drop([{}]));await tick();let tree=render();
  assert.match(textOf(tree),/本次未添加/);assert.equal(nodes(tree).filter(node=>node.props.className==='bos-folder-open').length,1);
  assert.equal(button(tree,'＋ 添加自定义文件夹').props.disabled,false);
  fail=false;area(tree).props.onDrop(drop([{}]));await tick();
  assert(!nodes(render()).some(node=>node.props.role==='alert'));
});

test('hidden quick rail reveals for folders and stays open while dropping; text drag is ignored',()=>{
  slots=[];layout={autoHideRail:true};
  globalThis.blackObsidian={quickLaunch:async()=>({folders:[],installs:[],selected:''})};
  let tree=render(),peek=nodes(tree).find(node=>node.props['aria-label']==='展开快捷栏');
  const plain={dataTransfer:{types:['text/plain']},preventDefault:()=>assert.fail('Text drag should not be captured')};
  peek.props.onDragOver(plain);area(tree).props.onDrop(plain);
  peek.props.onDragOver(drop([{}]));tree=render();
  let rail=nodes(tree).find(node=>node.type==='aside');assert.equal(rail.props['data-expanded'],true);
  area(tree).props.onDragEnter(drop([{}]));rail.props.onMouseLeave();tree=render();
  assert.equal(nodes(tree).find(node=>node.type==='aside').props['data-expanded'],true);
  area(tree).props.onDragLeave({currentTarget:{contains:()=>false},relatedTarget:null});
  nodes(tree).find(node=>node.type==='aside').props.onMouseLeave();
  assert.equal(nodes(render()).find(node=>node.type==='aside').props['data-expanded'],false);
});
