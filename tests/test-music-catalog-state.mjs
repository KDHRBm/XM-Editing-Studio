import test from 'node:test';
import assert from 'node:assert/strict';
import { requireMusicCatalog, watchMusicCatalog } from '../app/shared/music-catalog-state.mjs';

const catalog={tracks:[{id:'one'}],directories:[{id:'root',path:'music'}]};
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('unready and inaccessible libraries block analysis while intentionally empty libraries are supported',()=>{
  for(const bad of [undefined,{tracks:[]},{...catalog,loading:true},{...catalog,error:'disk error'},{...catalog,directories:[{error:'network unavailable'}]}])assert.throws(()=>requireMusicCatalog(bad));
  assert.equal(requireMusicCatalog(catalog),catalog);
  assert.deepEqual(requireMusicCatalog({tracks:[],directories:[]}),{tracks:[],directories:[]});
});
test('startup waits visibly and receives the ready catalog without navigating away',async()=>{
  const pending=deferred(),values=[],loading=[];
  const stop=watchMusicCatalog({getMusicLibrary:()=>pending.promise},{onCatalog:v=>values.push(v),onError:assert.fail,onLoading:v=>loading.push(v)});
  await flush();assert.deepEqual(values,[]);assert.deepEqual(loading,[true]);
  pending.resolve(catalog);await flush();assert.deepEqual(values,[catalog]);assert.equal(loading.at(-1),false);stop();
});
test('a refresh in another page updates this page and a late initial read cannot erase it',async()=>{
  const pending=deferred(),values=[];let changed,unsubscribed=false;
  const stop=watchMusicCatalog({getMusicLibrary:()=>pending.promise,onMusicLibraryChanged:fn=>{changed=fn;return()=>{unsubscribed=true;};}},{onCatalog:v=>values.push(v),onError:assert.fail,onLoading:()=>{}});
  await flush();changed(catalog);pending.resolve({tracks:[],directories:[]});await flush();
  assert.deepEqual(values,[catalog]);stop();assert.equal(unsubscribed,true);changed({tracks:[],directories:[]});assert.deepEqual(values,[catalog]);
});
test('a failed read reports the failure without replacing a known catalog with an empty array',async()=>{
  const errors=[],values=[];
  const stop=watchMusicCatalog({getMusicLibrary:async()=>{throw Error('共享目录超时');}},{onCatalog:v=>values.push(v),onError:v=>errors.push(v),onLoading:()=>{}});
  await flush();assert.deepEqual(values,[]);assert.deepEqual(errors,['共享目录超时']);stop();
});
