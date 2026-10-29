import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { serveStatic, createDesktopServer } from '../app/server/desktop-server.mjs';

test('companion videos support full, partial, suffix, HEAD and invalid range requests', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-video-range-'));
  const server = createServer((req, res) => void serveStatic(req, res, root));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  await fs.writeFile(path.join(root, 'pet.webm'), '0123456789');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/pet.webm`;
  const full = await fetch(url); assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'video/webm'); assert.equal(await full.text(), '0123456789');
  assert.equal(full.headers.get('cache-control'), 'no-cache');
  for (const filename of ['companion-orb.html', 'companion-orb.js', 'companion-panel.html']) {
    await fs.writeFile(path.join(root, filename), 'new version');
    const response = await fetch(new URL(filename, url));
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.equal(await response.text(), 'new version');
  }
  for (const [range, body, content] of [['bytes=2-4', '234', 'bytes 2-4/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-', '89', 'bytes 8-9/10'], ['bytes=8-100', '89', 'bytes 8-9/10']]) {
    const response = await fetch(url, { headers: { range } }); assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), content); assert.equal(await response.text(), body);
  }
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
  for (const range of ['bytes=99-', 'bytes=5-2', 'bytes=-0', 'bytes=', 'bytes=1-2,4-6']) {
    const response = await fetch(url, { headers: { range } }); assert.equal(response.status, 416, range); assert.equal(response.headers.get('content-range'), 'bytes */10'); await response.arrayBuffer();
  }
});

test('complete companion preview only exposes video files within its own resource root', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-pet-preview-'));
  const media = path.join(root, 'characters'); await fs.mkdir(media);
  await fs.writeFile(path.join(media, '待机.webm'), '0123456789');
  await fs.writeFile(path.join(media, 'settings.json'), 'secret');
  await fs.writeFile(path.join(root, 'outside.webm'), 'outside');
  const server = await createDesktopServer({ clientDirectory: root, companionDirectory: media, port: 0 });
  t.after(async () => { await new Promise(r => server.close(r)); await fs.rm(root, {recursive:true,force:true}); });
  const url = `http://127.0.0.1:${server.address().port}/companion-assets/`;
  const response=await fetch(url+encodeURIComponent('待机.webm'),{headers:{range:'bytes=2-4'}});
  assert.equal(response.status,206); assert.equal(await response.text(),'234');
  for(const file of ['settings.json','missing.webm','..%2foutside.webm','..%5coutside.webm']) {
    const denied=await fetch(url+file); assert.ok([403,404].includes(denied.status), file); await denied.text();
  }
});
