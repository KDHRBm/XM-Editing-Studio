import test from 'node:test';
import assert from 'node:assert/strict';
import { createScriptQueue } from '../app/shared/script-queue.mjs';
import { groupMusicJobs } from '../app/shared/music-batches.mjs';
import { splitScript } from '../app/shared/script-score.mjs';
import { score } from './script-test-fixtures.mjs';

test('a segmented submission remains one batch after restart and removal; repeated titles start a new batch', async () => {
  const script = '[EN] JACK: Run!\n[EN] MIA: We made it.';
  const input = { script, lines: splitScript(script), title: '同一剧本', segmented: true, segmentCount: 2, durationSeconds: 60 };
  const config = { providerId: 'p', baseUrl: 'http://mock', protocol: 'suno', model: 'test' };
  let sequence = 0, saved, requests = 0;
  const options = {
    uuid: () => String(++sequence), now: () => 12345,
    save: jobs => { saved = structuredClone(jobs); },
    getProvider: () => ({ ...config, apiKey: 'test' }),
    request: async url => {
      assert.equal(url, '/api/script/score'); requests++;
      return { segments: [1, 2].map(line => ({ title: `情节${line}`, startLine: line, endLine: line, summary: '追逐后重逢', keywords: ['piano'], score })) };
    },
  };
  const queue = createScriptQueue(options);
  const first = queue.add(input, config, config);
  const second = queue.add(input, config, config);
  queue.startOnly(first); await queue.tick(); queue.pause();
  let batches = groupMusicJobs(saved);
  assert.deepEqual(batches.map(batch => [batch.id, batch.title, batch.jobs.length]), [[first, '同一剧本', 2], [second, '同一剧本', 1]]);
  assert.equal(batches[0].createdAt, 12345);
  const restored = createScriptQueue({ ...options, initial: saved });
  await restored.tick(); assert.equal(requests, 1);
  restored.remove(batches[0].jobs[0].id);
  batches = groupMusicJobs(saved);
  assert.deepEqual(batches.map(batch => [batch.id, batch.jobs.length]), [[first, 1], [second, 1]]);
  restored.startOnly(second); await restored.tick(); restored.pause();
  assert.deepEqual(groupMusicJobs(saved).map(batch => [batch.id, batch.jobs.length]), [[first, 1], [second, 2]]);
  assert.equal(requests, 2);
});

test('legacy segment groups retain identity, omit archived records and report per-batch state', () => {
  const jobs = [
    { id: 'a', parentId: 'old', title: '重逢 · 1. 开始', status: 'complete', createdAt: 100 },
    { id: 'b', parentId: 'old', title: '重逢 · 2. 发展', status: 'pending', createdAt: 100 },
    { id: 'c', parentId: 'old', title: '重逢 · 3. 转折', status: 'uncertain', createdAt: 100 },
    { id: 'd', parentId: 'old', title: '重逢 · 4. 结束', status: 'error', archived: true },
    { id: 'e', title: '重逢', status: 'queued', createdAt: 100 },
  ];
  const copy = structuredClone(jobs);
  const batches = groupMusicJobs(jobs);
  assert.deepEqual(batches.map(({ id, title, complete, active, attention, jobs }) => ({ id, title, complete, active, attention, count: jobs.length })), [
    { id: 'old', title: '重逢', complete: 1, active: 1, attention: 1, count: 3 },
    { id: 'e', title: '重逢', complete: 0, active: 0, attention: 0, count: 1 },
  ]);
  assert.deepEqual(jobs, copy);
  assert.deepEqual(groupMusicJobs(jobs.map(job => ({ ...job, archived: true }))), []);
});

const config = { providerId: 'p', baseUrl: 'http://mock', protocol: 'suno', model: 'test' };
const base = { title: '批次', script: '[EN] JACK: Run!', lines: splitScript('[EN] JACK: Run!'), gemini: config, suno: config, durationSeconds: 60, createdAt: 100, tracks: [], taskIds: [] };

test('close one batch preserves history and pending queries without resubmitting; other batch stays', async () => {
  const archived = [], calls = [];
  const q = createScriptQueue({
    initial: [
      {...base, id:'done', batchId:'a', status:'complete', tracks:[{id:'done-track',audioUrl:'https://example.com/done.mp3',status:'complete'}]},
      {...base, id:'pending', batchId:'a', status:'pending', taskIds:['remote-1'], tracks:[{id:'remote-1',taskId:'remote-1',status:'pending'}]},
      {...base, id:'unsent', batchId:'a', status:'ready', score},
      {...base, id:'other', batchId:'b', status:'queued'}
    ], save:()=>{}, now:()=>10000, getProvider:()=>({...config,apiKey:'mock'}), onArchive:job=>archived.push(structuredClone(job)),
    request:async(url)=>{calls.push(url);return {tracks:[{id:'ready-1',taskId:'remote-1',status:'complete',audioUrl:'https://example.com/ready.mp3'}]};}
  });
  q.closeBatch('a');
  assert.deepEqual(groupMusicJobs(q.snapshot().jobs).map(b=>b.id),['b']);
  assert.equal(q.snapshot().jobs.some(j=>j.id==='unsent'),false);
  assert.deepEqual(archived.map(j=>j.id),['done','pending']);
  await q.tick(); await q.tick(); await q.tick();
  assert.deepEqual(calls,['/api/music/query']);
  assert.ok(archived.some(j=>j.id==='pending'&&j.status==='complete'&&j.historyDetached));
  assert.deepEqual(q.snapshot().jobs.map(j=>j.id),['other']);
});

test('failed history save never removes a batch', () => {
  const q=createScriptQueue({initial:[{...base,id:'done',batchId:'a',status:'complete',taskIds:['remote']}],save:()=>{},onArchive:()=>{throw Error('disk full');}});
  const before=structuredClone(q.snapshot());
  assert.throws(()=>q.closeBatch('a'),/disk full/);
  assert.deepEqual(q.snapshot(),before);
});

test('closing during planning discards its delayed result and never generates music', async () => {
  let resolve, calls=0;
  const gate=new Promise(r=>{resolve=r});
  const q=createScriptQueue({initial:[{...base,id:'planning',batchId:'a',status:'queued'}],save:()=>{},getProvider:()=>({...config,apiKey:'mock'}),request:async()=>{calls++;await gate;return {score};}});
  q.start(); const work=q.tick(); q.closeBatch('a'); resolve(); await work; await q.tick();
  assert.equal(calls,1); assert.deepEqual(q.snapshot().jobs,[]);
});

test('closing in-flight submission keeps response tracking and prevents duplicate generation', async () => {
  let resolve, calls=0;
  const gate=new Promise(r=>{resolve=r});
  const q=createScriptQueue({initial:[{...base,id:'submit',batchId:'a',status:'ready',score}],save:()=>{},getProvider:()=>({...config,apiKey:'mock'}),now:()=>10000,request:async()=>{calls++;await gate;return {tracks:[{id:'remote',taskId:'remote',status:'pending'}]};}});
  q.start(); const work=q.tick(); q.closeBatch('a'); resolve(); await work;
  assert.equal(calls,1); assert.equal(q.snapshot().jobs[0].archived,true);
  assert.equal(q.snapshot().jobs[0].status,'pending'); assert.deepEqual(q.snapshot().jobs[0].taskIds,['remote']);
});
