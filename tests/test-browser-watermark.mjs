import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWatermarkBrowser, findWatermarkBrowsers } from '../app/electron/watermark-browser.mjs';
import { loadBrowserSession, hardwarePreference } from '../watermarker/src/browser-session.mjs';

test('browser discovery checks installed executable locations without a shell', async () => {
  const root = path.resolve('.generated/tests/test-browser-install');
  const list = await findWatermarkBrowsers({ env: { ProgramFiles: root }, exists: async file => file.endsWith('msedge.exe') });
  assert.equal(list.find(b => b.id === 'edge').available, true);
  assert.equal(list.find(b => b.id === 'chrome').available, false);
});

test('browser task carries selected video, custom watermark and settings; streams only authorized files', async () => {
  const root = await fs.mkdtemp(path.resolve('.generated/tests/browser-task-test-'));
  const video = path.join(root, '中文视频.mp4'), image = path.join(root, '水印.png');
  const bytes = Buffer.from('0000ftypmp42fixture video contents');
  await fs.writeFile(video, bytes); await fs.writeFile(image, 'png-fixture');
  const clientDirectory = path.join(root, 'client');
  await fs.mkdir(path.join(clientDirectory, 'watermarker'), { recursive: true });
  await fs.writeFile(path.join(clientDirectory, 'watermarker/index.html'), '<!doctype html><title>Watermark fixture</title>');
  let launched, clock = 0;
  const manager = createWatermarkBrowser({ clientDirectory, now: () => clock, ttl: 1000,
    discover: async () => [{ id: 'edge', name: 'Microsoft Edge', executable: 'edge.exe', available: true }],
    launch: async (exe, url) => { launched = { exe, url: new URL(url) }; },
  });
  try {
    const result = await manager.open({ browser: 'edge', files: [video], watermark: image, settings: { size: '720', crf: '28', audio: 'aac' } });
    assert.equal(result.count, 1); assert.equal(launched.exe, 'edge.exe');
    const origin = launched.url.origin, hash = launched.url.hash;
    const token = new URLSearchParams(hash.slice(1)).get('session');
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(origin + '/session/info')).status, 401);
    assert.equal((await fetch(origin + '/session/info', { headers: { ...headers, Origin: 'https://other.invalid' } })).status, 403);
    assert.equal((await fetch(origin + '/session/file/99', { headers })).status, 404);
    assert.equal((await fetch(origin + '/api/music/query', { headers })).status, 404);
    assert.equal((await fetch(origin + '/local-music/track', { headers })).status, 404);
    assert.equal((await fetch(origin + '/watermarker/index.html')).status, 200);
    const partial = await fetch(origin + '/session/file/0', { headers: { ...headers, Range: 'bytes=4-7' } });
    assert.equal(partial.status, 206); assert.equal(await partial.text(), 'ftyp');
    const session = await loadBrowserSession({ hash, fetcher: (url, opts) => fetch(origin + url, opts) });
    assert.equal(session.files[0].name, '中文视频.mp4');
    assert.equal(session.settings.size, '720'); assert.equal(session.settings.crf, '28'); assert.equal(session.settings.audio, 'aac');
    assert.equal(await session.watermarkBlob.text(), 'png-fixture');
    assert.deepEqual(Buffer.from(await session.files[0].readBytes()), bytes);
    assert.deepEqual(Buffer.from(await new Response(await session.files[0].stream()).arrayBuffer()), bytes);
    assert.ok(!JSON.stringify(await (await fetch(origin + '/session/info', { headers })).json()).includes(root));
    await fs.appendFile(video, 'changed');
    assert.equal((await fetch(origin + '/session/file/0', { headers })).status, 409);
    clock = 1001; assert.equal((await fetch(origin + '/session/info', { headers })).status, 401);
    await assert.rejects(manager.open({ browser: 'arbitrary', files: [video] }), /Chrome 或 Edge/);
    await assert.rejects(manager.open({ browser: 'chrome', files: [video] }), /未找到/);
  } finally { await manager.dispose(); }
});

test('hardware preference reports actual capability instead of claiming guaranteed acceleration', async () => {
  const options = { videoCodec: 'avc1.42E032', width: 1280, height: 720, bitrate: 2e6 };
  assert.equal(await hardwarePreference(options, { isConfigSupported: async config => { assert.equal(config.hardwareAcceleration, 'prefer-hardware'); return { supported: true }; } }), 'prefer-hardware');
  assert.equal(await hardwarePreference(options, { isConfigSupported: async () => ({ supported: false }) }), 'no-preference');
  assert.equal(await hardwarePreference(options, { isConfigSupported: async () => { throw new Error('unavailable'); } }), 'no-preference');
});
