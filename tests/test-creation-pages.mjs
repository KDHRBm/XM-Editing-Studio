import test from 'node:test';
import assert from 'node:assert/strict';
import { creationRows, groupCreationRows } from '../app/shared/creation-pages.mjs';

test('ten songs per page across job boundaries preserves original track indices for downloads', () => {
  const jobs = [{ id: 'one', tracks: Array.from({ length: 9 }, (_, n) => ({ id: 'a' + n })) }, { id: 'two', tracks: [{ id: 'b0' }, { id: 'b1' }] }];
  const rows = creationRows(jobs), first = groupCreationRows(rows.slice(0, 10)), last = groupCreationRows(rows.slice(10, 20));
  assert.equal(first.reduce((n, group) => n + group.tracks.length, 0), 10);
  assert.equal(last.length, 1); assert.equal(last[0].job, jobs[1]); assert.equal(last[0].tracks[0].index, 1); assert.equal(last[0].tracks[0].track.id, 'b1');
  assert.equal(jobs[1].tracks.length, 2);
});
test('pending jobs without tracks remain visible for recovery and empty history is safe', () => {
  const pending = { id: 'uncertain', tracks: [] };
  assert.deepEqual(groupCreationRows(creationRows([pending])), [{ job: pending, tracks: [] }]);
  assert.deepEqual(creationRows([]), []);
});
