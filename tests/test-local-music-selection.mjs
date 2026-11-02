import test from 'node:test';
import assert from 'node:assert/strict';
import { createScriptQueue } from '../app/shared/script-queue.mjs';
import { findLocalSelections, localSelectionScope } from '../app/shared/local-music-selection.mjs';
import { splitScript } from '../app/shared/script-score.mjs';

const input = { script: '  第一集\r\n[EN] JACK: Stay.\r\n[EN] MIA: Wait.\r\n' };
const lines = splitScript(input.script), track = { id: 'a'.repeat(64), title: '悬疑钢琴' };
const analysis = { summary: '紧张对峙', keywords: ['悬疑'] }, origin = 'http://127.0.0.1:37651';
const segment = { startLine: 2, endLine: 2 };
const context = { ...input, projectId: 'project-a', lines };

test('cancel selection persists and only removes the same script/project/scene, including duplicate older selections', () => {
  let saved, sequence = 0;
  const history = new Map();
  const options = { save: jobs => { saved = structuredClone(jobs); }, uuid: () => String(++sequence), onComplete: job => history.set(job.id, job), onLocalCancelled: jobs => jobs.forEach(job => history.delete(job.id)) };
  const queue = createScriptQueue(options);
  const add = (scope, changed = {}) => queue.addLocal({ ...input, lines, ...changed }, track, analysis, '', '', origin, scope);
  const whole = add(localSelectionScope('project-a'));
  const otherScene = add(localSelectionScope('project-a', segment), { lines: lines.slice(0, 1) });
  const otherProject = add(localSelectionScope('project-b'));
  const otherScript = add(localSelectionScope('project-a'), { script: input.script + '[EN] A: Go.' });
  const olderDuplicate = add(undefined);
  const matches = findLocalSelections(queue.snapshot().jobs, context, track.id);
  assert.deepEqual(matches.map(job => job.id), [whole, olderDuplicate]);
  queue.cancelLocal(matches.map(job => job.id));
  assert.deepEqual(queue.snapshot().jobs.map(job => job.id), [otherScene, otherProject, otherScript]);
  assert.deepEqual([...history.keys()], [otherScene, otherProject, otherScript]);
  const reopened = createScriptQueue({ ...options, initial: saved });
  assert.equal(findLocalSelections(reopened.snapshot().jobs, context, track.id).length, 0);
  assert.equal(findLocalSelections(reopened.snapshot().jobs, { ...context, segment }, track.id).length, 1);
  add(localSelectionScope('project-a'));
  assert.equal(findLocalSelections(queue.snapshot().jobs, context, track.id).length, 1);
});

test('failed persistence cannot cancel selection; active exports and Suno tasks are protected', () => {
  let fail = false, cancelled = 0;
  const queue = createScriptQueue({ save: () => { if (fail) throw new Error('disk full'); }, onLocalCancelled: () => cancelled++ });
  const id = queue.addLocal({ ...input, lines }, track, analysis, '', '', origin, localSelectionScope('project-a'));
  fail = true;
  assert.throws(() => queue.cancelLocal([id]), /disk full/);
  assert.equal(queue.snapshot().jobs.length, 1); assert.equal(cancelled, 0);
  const job = queue.snapshot().jobs[0];
  job.exportState = 'exporting';
  assert.throws(() => queue.cancelLocal([id]), /正在导出/);
  job.exportState = 'done'; job.source = 'suno';
  assert.throws(() => queue.cancelLocal([id]), /本地音乐/);
  job.source = 'library'; job.archived = true;
  assert.throws(() => queue.cancelLocal([id]), /当前选用/);
  assert.equal(findLocalSelections(queue.snapshot().jobs, context, track.id).length, 0);
});
