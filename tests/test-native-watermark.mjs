import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createWatermarkHost } from '../app/electron/watermark-host.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
let prepared;

async function engineFixture(t) {
  if (process.platform !== 'win32') { t.skip('Windows Media Foundation requires Windows'); return null; }
  const compiler = path.join(process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  try { await access(compiler); }
  catch { t.skip('.NET Framework 4.x C# compiler is not available'); return null; }
  prepared ||= (async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'xm-watermark-engine-'));
    const directory = path.join(root, 'build', 'watermark');
    await mkdir(directory, { recursive: true });
    const executable = path.join(directory, 'WatermarkEngine.exe');
    const source = path.resolve('app/native/WatermarkEngine.cs');
    const result = spawnSync(compiler, ['/nologo', '/utf8output', '/codepage:65001', '/target:exe', '/platform:x64', '/optimize+', '/r:System.Web.Extensions.dll', '/r:System.Drawing.dll', `/out:${executable}`, source], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
    const digest = sha256(await readFile(executable));
    await writeFile(path.join(directory, 'engine.json'), JSON.stringify({ sha256: digest }));
    await copyFile(path.resolve('watermarker/public/watermark.png'), path.join(directory, 'watermark.png'));
    return { root, executable, compiler, manifest: path.join(directory, 'engine.json') };
  })();
  return prepared;
}

after(async () => {
  if (prepared) {
    try { await rm((await prepared).root, { recursive: true, force: true }); }
    catch { /* A failed compile is reported by the test. */ }
  }
});

async function waitForFinished(host) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const state = await host.getState();
    if (!state.running && state.jobs.length) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Watermark batch did not finish');
}

test('native watermark engine builds with a matching manifest and original watermark', async t => {
  const fixture = await engineFixture(t);
  if (!fixture) return;
  const { root, executable, manifest } = fixture;
  assert.equal(JSON.parse(await readFile(manifest, 'utf8')).sha256, sha256(await readFile(executable)));
  assert.equal(sha256(await readFile(path.join(root, 'build', 'watermark', 'watermark.png'))),
    sha256(await readFile(path.resolve('watermarker/public/watermark.png'))));
  const probe = spawnSync(executable, ['--verify-runtime'], { encoding: 'utf8', windowsHide: true });
  assert.equal(probe.status, 0);
  assert.equal(JSON.parse(probe.stdout.trim()).ok, true);
});

test('native watermark processes a video with audio and avoids overwriting the previous output', async t => {
  const fixture = await engineFixture(t);
  if (!fixture) return;
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (ffmpeg.error) return t.skip('ffmpeg is not available for the video fixture');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xm-watermark-'));
  const input = path.join(directory, 'input.mp4');
  const sample = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input], { windowsHide: true });
  assert.equal(sample.status, 0);
  const host = createWatermarkHost({ appDirectory: fixture.root, dataDirectory: path.join(directory, 'profile') });
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

test('native frame normalization preserves cropped pixels and timing with positive/negative padded pitch', async t => {
  const fixture = await engineFixture(t);
  if (!fixture) return;
  const executable = path.join(fixture.root, 'FrameLayoutTests.exe');
  const compile = spawnSync(fixture.compiler, ['/nologo', '/utf8output', '/codepage:65001', '/target:exe', '/platform:x64',
    '/r:System.Web.Extensions.dll', '/r:System.Drawing.dll', '/main:XMWatermark.FrameLayoutTests', `/out:${executable}`,
    path.resolve('app/native/WatermarkEngine.cs'), path.resolve('tests/WatermarkFrameTests.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(compile.status, 0, compile.stdout || compile.stderr);
  const run = spawnSync(executable, [fixture.root], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stdout || run.stderr);
});

// A solid-color 320px fixture cannot detect the diagonal tearing caused by the
// first decoded sample changing from 1080x1922 to a padded 1088x1936 RGB frame.
for (const [width, height, size] of [[1080, 1922, 'original'], [854, 480, 'original'], [1080, 1922, '480p']]) {
  test(`native watermark preserves patterned pixels at ${width}x${height} / ${size}`, async t => {
    const fixture = await engineFixture(t);
    if (!fixture) return;
    if (spawnSync('ffmpeg', ['-version'], { windowsHide: true }).error) return t.skip('ffmpeg unavailable');
    const directory = path.join(fixture.root, `${width}-${height}-${size}`);
    await mkdir(directory);
    const input = path.join(directory, 'pattern.mp4');
    const generate = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:r=12:d=1`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input], { windowsHide: true });
    assert.equal(generate.status, 0, generate.stderr?.toString());
    const host = createWatermarkHost({ appDirectory: fixture.root, dataDirectory: path.join(directory, 'profile') });
    t.after(() => host.dispose());
    await host.updateSettings({ position: 'top-left', scale: 0.08, size, crf: 18 });
    await host.addVideos([input]);
    await host.startBatch();
    const state = await waitForFinished(host);
    assert.equal(state.jobs[0].status, 'done', state.jobs[0].error);
    const output = state.jobs[0].outputPath;
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration', '-of', 'json', output], { encoding: 'utf8', windowsHide: true });
    assert.equal(probe.status, 0, probe.stderr);
    const streams = JSON.parse(probe.stdout).streams;
    const video = streams.find(stream => stream.codec_type === 'video');
    const expectedWidth = size === '480p' ? 480 : width;
    const expectedHeight = size === '480p' ? 854 : height;
    assert.deepEqual([video.width, video.height], [expectedWidth, expectedHeight]);
    assert.ok(Math.abs(Number(video.duration) - 1) < 0.1, 'Video timing changed');
    const audio = streams.find(stream => stream.codec_type === 'audio');
    assert.ok(audio && Math.abs(Number(audio.duration) - 1) < 0.1, 'Audio or its timing was lost');
    const decode = file => {
      const result = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=120:120', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { windowsHide: true });
      assert.equal(result.status, 0, result.stderr?.toString());
      assert.equal(result.stdout.length, 120 * 120 * 3);
      return result.stdout;
    };
    const original = decode(input), rendered = decode(output);
    let error = 0, count = 0;
    // Exclude the watermark corner; every other row/column must retain its content.
    for (let y = 30; y < 115; y++) for (let x = 30; x < 115; x++) for (let c = 0; c < 3; c++) {
      const offset = (y * 120 + x) * 3 + c;
      error += Math.abs(original[offset] - rendered[offset]); count++;
    }
    assert.ok(error / count < 8, `Image changed/shifted: mean RGB error ${error / count}`);
    let watermarkDifference = 0;
    for (let y = 2; y < 25; y++) for (let x = 2; x < 25; x++) {
      const offset = (y * 120 + x) * 3;
      watermarkDifference += Math.abs(original[offset] - rendered[offset]);
    }
    assert.ok(watermarkDifference > 100, 'Watermark is missing');
  });
}
