import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBatchMusic, batchKeywordMessages } from '../app/shared/batch-music.mjs';
import { analyzeWithWeb } from '../app/shared/web-script-analysis.mjs';
import { parseSegments, segmentMessages } from '../app/shared/script-segments.mjs';
import { createMusicUsageStore, excludeUsedMusic } from '../app/shared/library-usage.mjs';
import { createPunctuationClipboard, restoreProtectedPunctuation } from '../app/electron/period-clipboard.mjs';
import { createPeriodControls } from '../app/electron/period-controls.mjs';

const tracks = Array.from({length:8},(_,n)=>({id:`local-${n}`,title:`悬疑弦乐${n}`}));
const episodes = [31,32,33].map(n=>({id:`ep-${n}`,episodeNumber:n,title:`第${n}集`,script:`第${n}集\n${n}-1 办公室\n[EN] A: Wait...\n${n}-2 走廊\n[EN] B: Come here.`}));
const match = id => ({id,reason:'弦乐与持续紧张的情绪匹配',keywords:['紧张']});
const planned = input => ({episodes:input.episodes.map(e=>({id:e.id,summary:'连续紧张的对峙',keywords:['悬疑'],segments:[{title:'追问真相',summary:'质问逐步升级',keywords:['悬疑'],startLine:1,endLine:5}]}))});

test('one invalid second music ID is corrected only for its episode; other five-track results survive',async()=>{
  let calls=0;
  const result=await analyzeBatchMusic({episodes,tracks,segmented:true,segmentCount:2},async messages=>{
    const input=JSON.parse(messages[1].content);
    if(++calls===1)return JSON.stringify(planned(input));
    if(calls===2)return JSON.stringify({episodes:input.episodes.map((e,n)=>({id:e.id,segments:[{id:'segment-1',matches:n===1?[match('local-0'),match('invented-id')]:tracks.slice(0,5).map(t=>match(t.id))}]}))});
    assert.deepEqual(input.episodes.map(e=>e.id),['ep-32']);
    assert.equal(input.episodes[0].segments[0].acceptedMatches[0].id,'local-0');
    assert.match(input.episodes[0].segments[0].validationError,/ID 无效/);
    return JSON.stringify({episodes:[{id:'ep-32',segments:[{id:'segment-1',matches:tracks.slice(1,5).map(t=>match(t.id))}]}]});
  });
  assert.equal(calls,3);
  assert.ok(result.episodes.every(e=>e.value.segments[0].matches.length===5));
  assert.ok(result.episodes.every(e=>e.value.segments[0].warning===''));
});

test('repeated invalid IDs are filtered after one repair while every valid episode and section is retained',async()=>{
  let calls=0;
  const result=await analyzeBatchMusic({episodes,tracks,segmented:true,segmentCount:2},async messages=>{
    const input=JSON.parse(messages[1].content);
    if(++calls===1)return JSON.stringify(planned(input));
    return JSON.stringify({episodes:input.episodes.map(e=>({id:e.id,segments:[{id:'segment-1',matches:[match('local-0'),match('bad')]}]}))});
  });
  assert.equal(calls,3);
  for(const {value} of result.episodes){assert.deepEqual(value.matches.map(m=>m.id),['local-0']);assert.match(value.segments[0].warning,/已过滤/);assert.match(value.segments[0].noMatchReason,/未达到5首/);}
});

test('missing recommendations are supplemented to five in workspace whole and segment workflows',async()=>{
  for(const segmented of [false,true]){
    let calls=0;
    const result=await analyzeWithWeb('library-match',{script:episodes[0].script,tracks,segmented,segmentCount:2},async messages=>{
      calls++;
      const input=JSON.parse(messages[1].content);
      if(calls===1)return JSON.stringify(segmented?{segments:planned({episodes}).episodes[0].segments}:{summary:'紧张对峙',keywords:['悬疑']});
      assert.match(messages[0].content,/至少推荐5首/);
      const selected=tracks.slice(calls===2?0:2,calls===2?2:5).map(t=>match(t.id));
      return JSON.stringify(segmented?{segments:input.segments.map(s=>({id:s.id,matches:selected}))}:{matches:selected});
    });
    assert.equal(calls,3);assert.equal((segmented?result.segments[0]:result).matches.length,5);
  }
});

test('one continuous plot may span several printed scene numbers with complete coverage',()=>{
  const input={...episodes[0],segmentCount:2,segmented:true,episodes};
  assert.match(batchKeywordMessages(input)[0].content,/场次号/);
  assert.match(segmentMessages(input,'library')[0].content,/1–2/);
  const one=planned({episodes}).episodes[0].segments;
  assert.equal(parseSegments(JSON.stringify({segments:one}),input,'library').length,1);
  assert.throws(()=>parseSegments(JSON.stringify({segments:[{...one[0],endLine:4}]}),input,'library'),/完整剧本/);
});

test('usage toggles off persistently, informs both pages, and restores eligibility without changing other records',()=>{
  const values=new Map();const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const usage=createMusicUsageStore(storage);let events=0;usage.subscribe(()=>events++);
  for(const track of tracks)usage.remember(track);
  assert.equal(usage.toggle(tracks[0]),false);
  assert.deepEqual(excludeUsedMusic(tracks,usage.snapshot().history).map(t=>t.id),['local-0']);
  const reopened=createMusicUsageStore(storage);assert.equal(reopened.snapshot().history.length,7);
  assert.equal(reopened.toggle(tracks[0]),true);assert.equal(reopened.snapshot().history[0].id,'local-0');
  reopened.forget('local-1');assert.ok(!reopened.snapshot().history.some(t=>t.id==='local-1'));assert.equal(events,9);
});

function controlsFixture() {
  let text='', enabled=false, engine='active';const commands=[];
  const guard=createPunctuationClipboard({clipboard:{readText:async()=>text,writeText:async value=>{text=value;}},schedule:()=>1,cancel:()=>{}});
  const controls=createPeriodControls({guard,checkUpstreamStatus:async()=>{},command:async name=>{commands.push(name);if(name==='enable')enabled=true;if(name==='disable')enabled=false;return {enabled,engine};},shutdown:async()=>{enabled=false;}});
  return {controls,guard,commands,get text(){return text;},set engine(value){engine=value;}};
}

test('batch protection enables native keeper before copying all commas, periods and ellipses, without enabling workspace polling',async()=>{
  const f=controlsFixture();await f.controls.setBatchEnabled(true);
  const text='Hello, world.\nWait...\nEspera...';const result=await f.controls.copy(text,{protect:true});
  assert.equal(result.copiedLines,3);assert.equal(result.nativeEngine,'active');assert.equal(result.warning,'');
  assert.equal(f.text,'Hello‚ world․\r\nWait․․․\r\nEspera․․․');
  assert.equal(restoreProtectedPunctuation(f.text).replace(/\r\n/g,'\n'),text);
  const state=await f.controls.status();assert.equal(state.enabled,false);assert.equal(state.nativeEnabled,true);assert.equal(f.guard.status().clipboardProtected,false);
  await f.controls.setEnabled(true);await f.controls.setBatchEnabled(false);assert.equal((await f.controls.status()).nativeEnabled,true);
  await f.controls.setEnabled(false);assert.equal((await f.controls.status()).nativeEnabled,false);
});

test('unsupported native punctuation rules are visible; protected clipboard still remains complete',async()=>{
  const f=controlsFixture();f.engine='unsupported';
  await f.controls.setBatchEnabled(true);
  const result=await f.controls.copy('All, words... remain.',{protect:true});
  assert.match(result.warning,/尚未确认生效/);assert.equal(result.copyVerified,true);
  assert.equal(restoreProtectedPunctuation(f.text),'All, words... remain.');
  await f.controls.copy('Plain, text.',{protect:false});assert.equal(f.text,'Plain, text.');
});

test('one click copies before a slow native scan finishes; concurrent enable requests share one scan', async () => {
  let text = '', release, started, commands = 0;
  const entered = new Promise(resolve => { started = resolve; });
  const guard = createPunctuationClipboard({ clipboard: { readText: async () => text, writeText: async value => { text = value; } }, schedule: () => 1, cancel: () => {} });
  const controls = createPeriodControls({ guard, checkUpstreamStatus: async () => {}, command: async () => { commands++; started(); await new Promise(resolve => { release = resolve; }); return { enabled: true, engine: 'active' }; }, shutdown: async () => {} });
  const preparing = controls.setBatchEnabled(true); await entered;
  const result = await Promise.race([controls.copy('First, line.\nLast line...', { protect: true }), new Promise((_, reject) => { const timer=setTimeout(()=>reject(new Error('copy blocked on native scan')),500);timer.unref(); })]);
  assert.equal(result.copyVerified,true);assert.equal(result.copiedLines,2);
  assert.match(result.warning,/后台准备/);assert.equal(commands,1);
  assert.equal(text,'First‚ line․\r\nLast line․․․');
  release();await preparing;assert.equal(text,'First‚ line․\r\nLast line․․․');
  await controls.copy('Second, copy.',{protect:true});assert.equal(commands,1,'copy does not rescan an enabled native engine');
  assert.equal(text,'Second‚ copy․');await controls.dispose();
});

test('failed native initialization cannot suppress a verified protected copy',async()=>{
  let text='';
  const guard=createPunctuationClipboard({clipboard:{readText:async()=>text,writeText:async value=>{text=value;}}});
  const controls=createPeriodControls({guard,checkUpstreamStatus:async()=>{throw new Error('offline');},command:async()=>{throw new Error('must not reach');},shutdown:async()=>{}});
  const result=await controls.copy('Complete, words.',{protect:true});
  assert.equal(result.copyVerified,true);assert.equal(text,'Complete‚ words․');
  await controls.dispose();
});
