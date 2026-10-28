import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createWatermarkHost } from '../app/electron/watermark-host.mjs';

const root = path.resolve('app');
const executable = path.join(root, 'build', 'watermark', 'WatermarkEngine.exe');
const manifest = path.join(root, 'build', 'watermark', 'engine.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function waitForFinished(host) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await host.getState();
    if (!state.running && state.jobs.length) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Watermark batch did not finish');
}

test('native watermark engine is bundled with a matching manifest and original watermark', async () => {
  assert.equal(JSON.parse(await readFile(manifest, 'utf8')).sha256, sha256(await readFile(executable)));
  assert.equal(sha256(await readFile(path.join(root, 'build', 'watermark', 'watermark.png'))),
    sha256(await readFile(path.resolve('watermarker/public/watermark.png'))));
  const probe = spawnSync(executable, ['--verify-runtime'], { encoding: 'utf8', windowsHide: true });
  assert.equal(probe.status, 0);
  assert.equal(JSON.parse(probe.stdout.trim()).ok, true);
});

test('native watermark processes a video with audio and avoids overwriting the previous output', async t => {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (ffmpeg.error) return t.skip('ffmpeg is not available for the video fixture');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xm-watermark-'));
  const input = path.join(directory, 'input.mp4');
  const sample = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input], { windowsHide: true });
  assert.equal(sample.status, 0);
  const host = createWatermarkHost({ appDirectory: root, dataDirectory: path.join(directory, 'profile') });
  t.after(() => host.dispose());
  await host.addVideos([input]);
  await host.startBatch();
  const first = await waitForFinished(host);
  assert.equal(first.jobs[0].status, 'done', first.jobs[0].error);
  const firstOutput = first.jobs[0].outputPath;
  assert.equal(path.basename(firstOutput), 'input样片.mp4');
  assert.ok((await stat(firstOutput)).size > 1000);
  await host.addVideos([input]);
  await host.startBatch();
  const second = await waitForFinished(host);
  assert.equal(second.jobs[1].status, 'done', second.jobs[1].error);
  assert.notEqual(second.jobs[1].outputPath, firstOutput);
  assert.equal(path.basename(second.jobs[1].outputPath), 'input样片 (1).mp4');
  assert.ok((await stat(firstOutput)).size > 1000);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', firstOutput], { encoding: 'utf8', windowsHide: true });
  assert.equal(probe.status, 0);
  assert.match(probe.stdout, /video/);
  assert.match(probe.stdout, /audio/);
});
