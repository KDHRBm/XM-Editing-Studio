import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadRateTracker, formatDownloadRate, formatRemainingTime } from '../app/src/LocalDownloadRate.mjs';

test('local model progress shows measured speed and remaining time', () => {
  const tracker = createDownloadRateTracker();
  const progress = { stage: 'model', message: 'pulling layer', completed: 1000, total: 5000 };
  tracker.update(progress, 1000);
  assert.equal(tracker.read(progress, 1000), null);
  progress.completed = 2000;
  tracker.update(progress, 2000);
  assert.deepEqual(tracker.read(progress, 2000), { bytesPerSecond: 1000, remainingSeconds: 3 });
  assert.equal(tracker.read(progress, 13001), null);
});

test('speed resets when Ollama starts another layer or a download restarts', () => {
  const tracker = createDownloadRateTracker();
  const progress = { stage: 'model', message: 'pulling first layer', completed: 100, total: 1000 };
  tracker.update(progress, 1000);
  progress.completed = 500;
  tracker.update(progress, 2000);
  assert.ok(tracker.read(progress, 2000));
  progress.message = 'pulling second layer';
  progress.completed = 20;
  progress.total = 300;
  tracker.update(progress, 3000);
  assert.equal(tracker.read(progress, 3000), null);
  progress.completed = 50;
  tracker.update(progress, 4000);
  assert.deepEqual(tracker.read(progress, 4000), { bytesPerSecond: 30, remainingSeconds: 9 });
  tracker.update({ stage: 'verify', message: 'verifying', completed: 0, total: 0 }, 5000);
  assert.equal(tracker.read({ completed: 0, total: 0 }, 5000), null);
});

test('download status uses compact units', () => {
  assert.equal(formatDownloadRate(2 * 1024 * 1024), '2.0 MB/s');
  assert.equal(formatDownloadRate(512 * 1024), '512 KB/s');
  assert.equal(formatRemainingTime(40), '不到 1 分钟');
  assert.equal(formatRemainingTime(125), '约 3 分钟');
});
