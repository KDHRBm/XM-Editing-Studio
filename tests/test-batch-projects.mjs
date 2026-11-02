import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatchAnalysisQueue, splitEpisodes } from '../app/shared/batch-analysis.mjs';

const settings = { analyzerKey: 'webai:deepseek::DeepSeek', subtitleLanguage: 'en' };
const episodes = number => splitEpisodes(`第${number}集\n[EN] A: Hello, world.`).episodes;
function fixture(initial = null) {
  let data = initial, sequence = 100, fail = false, hold;
  const groups = [];
  const options = {
    load: async () => structuredClone(data),
    save: async value => { if (hold) await hold; if (fail) throw new Error('disk full'); data = structuredClone(value); },
    makeId: () => `new-${++sequence}`,
    analyze: async group => { groups.push(group.map(t => t.projectId)); return group.map(t => ({id:t.id, value:{analysis:{summary:t.title, keywords:[]}, matches:[]}})); }
  };
  return { queue: createBatchAnalysisQueue(options), reload: () => createBatchAnalysisQueue(options), groups,
    get data() { return data; }, set fail(value) { fail = value; }, set hold(value) { hold = value; } };
}

test('legacy batch cards migrate without losing IDs, subtitles, recommendations or retry state', async () => {
  const original = [{ id:'old1', ...episodes(1)[0], status:'complete', settings, result:{analysis:{summary:'existing'}, matches:[{id:'music'}]} } , { id:'old2', ...episodes(2)[0], status:'analyzing', settings }];
  const f = fixture({version:1,tasks:original}); await f.queue.initialize();
  const state = f.queue.snapshot();
  assert.equal(state.projects.length,1); assert.equal(state.projects[0].name,'未命名剧本');
  assert.deepEqual(state.tasks[0], {...original[0], projectId:state.activeProjectId});
  assert.equal(state.tasks[1].status,'paused');
  await f.queue.renameProject(state.activeProjectId,'亡妻归来');
  assert.equal(f.data.version,2); assert.equal(f.data.projects[0].name,'亡妻归来');
  const next = f.reload(); await next.initialize(); assert.deepEqual(next.snapshot().tasks, f.data.tasks);
});

test('five named dramas persist, selecting existing names costs no slot, and episodes never cross groups', async () => {
  const f=fixture(); await f.queue.initialize();
  const a=await f.queue.createProject('亡妻归来'); await f.queue.import(episodes(1),settings);
  const b=await f.queue.createProject('莫雷蒂夫人'); assert.equal(await f.queue.import(episodes(1),settings),1);
  assert.equal(await f.queue.createProject('  亡妻归来  '),a);
  assert.equal(await f.queue.import(episodes(1),settings),0);
  await f.queue.import(episodes(2),settings);
  await f.queue.start();
  assert.deepEqual(f.groups,[[a,a],[b]],'one AI request must never combine different dramas');
  for(const name of ['第三部','第四部','第五部']) await f.queue.createProject(name);
  await assert.rejects(f.queue.createProject('第六部'),/最多保留 5/);
  assert.equal(await f.queue.createProject('莫雷蒂夫人'),b);
  await assert.rejects(f.queue.renameProject(b,'亡妻归来'),/同名/);
  const next=f.reload(); await next.initialize(); assert.equal(next.snapshot().activeProjectId,b); assert.equal(next.snapshot().projects.length,5);
  assert.equal(next.backup(a).tasks.length,2); assert.equal(next.backup(a).projects.length,1);
  await next.clear(a); assert.equal(next.snapshot().tasks.length,1); assert.equal(next.snapshot().tasks[0].projectId,b);
  await next.removeProject(a); assert.equal(next.snapshot().projects.length,4); assert.equal(next.snapshot().activeProjectId,b);
  await next.removeProject(b); assert.equal(next.snapshot().tasks.length,0); assert.notEqual(next.snapshot().activeProjectId,b);
  await next.createProject('第六部'); assert.equal(next.snapshot().projects.length,4);
});

test('failed saves and overlapping tab actions preserve the prior drama and cards',async()=>{
  const f=fixture();await f.queue.initialize();const a=await f.queue.createProject('A');await f.queue.import(episodes(1),settings);
  const b=await f.queue.createProject('B');await f.queue.import(episodes(1),settings);
  const before=f.queue.backup(); f.fail=true;
  await assert.rejects(f.queue.removeProject(a),/disk full/);assert.deepEqual(f.queue.backup(),before);
  await assert.rejects(f.queue.selectProject(a),/disk full/);assert.equal(f.queue.snapshot().activeProjectId,b);
  await assert.rejects(f.queue.createProject('C'),/disk full/);assert.deepEqual(f.queue.backup(),before);
  f.fail=false;let release;f.hold=new Promise(resolve=>{release=resolve;});
  const changing=f.queue.selectProject(a);
  await assert.rejects(f.queue.removeProject(b),/正在保存/);
  await assert.rejects(f.queue.start(),/正在保存/);
  release();await changing;f.hold=null;
  assert.equal(f.data.activeProjectId,a);assert.equal(f.data.tasks.length,2);
});

test('invalid project references are not overwritten on load',async()=>{
  const f=fixture({version:2,projects:[],tasks:[{id:'orphan',projectId:'missing'}]});await f.queue.initialize();
  assert.equal(f.queue.snapshot().loaded,false);assert.match(f.queue.snapshot().error,/分组存档无效/);
  await assert.rejects(f.queue.createProject('新剧'),/尚未加载/);assert.equal(f.data.tasks[0].id,'orphan');
});
