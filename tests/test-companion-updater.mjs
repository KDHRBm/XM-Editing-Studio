import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createCompanionUpdater, selectPetRelease } from '../app/electron/companion-updater.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from('verified portable bytes');
const release = { tag_name: 'v4.4.0', assets: [{ name: 'dsh-pet-standalone-webm-chat-portable.zip', size: bytes.length, digest: 'sha256:' + hash(bytes), browser_download_url: 'https://github.com/MerZlin/dsh-pet-indesktop/releases/download/v4.4.0/dsh-pet-standalone-webm-chat-portable.zip' }] };
async function fixture() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-pet-updater-test-'));
  const base = path.join(temp, 'base'), data = path.join(temp, 'data');
  async function bundle(directory, version) {
    await fs.mkdir(path.join(directory, '_internal'), { recursive: true });
    for (const file of ['dsh-pet-standalone-webm-chat.exe', '_internal/xm_companion_bridge.py', '_internal/xm_companion_prepare.py']) await fs.writeFile(path.join(directory, file), 'fixture');
    await fs.writeFile(path.join(directory, 'xm-manifest.json'), JSON.stringify({ version, executableSha256: hash('fixture'), bridgeSha256: hash('fixture'), prepareSha256: hash('fixture'), animations: [] }));
  }
  await bundle(base, '4.3.4'); await fs.mkdir(path.join(data, 'desktop-pet'), { recursive: true });
  await fs.writeFile(path.join(data, 'desktop-pet/config.json'), 'original settings');
  let directory = base, running = true, visible = false;
  const runtime = { getDirectory: () => directory, setDirectory: value => { directory = value; }, isRunning: () => running, isVisible: () => visible, stop: async () => { running = false; }, start: async () => { running = true; return { ready: true }; }, run: async (_a, value) => { visible = value; } };
  let prepared = 0;
  const options = { runtime, baseDirectory: base, dataDirectory: data, fetcher: async url => url.includes('/releases/latest') ? Response.json(release) : new Response(bytes), prepare: async (_exe, request) => { prepared++; const r = JSON.parse(await fs.readFile(request, 'utf8')); await bundle(r.destination, r.version); }, makeProbe: () => ({ start: async () => ({ ready: true, version: '4.4.0' }), run: async () => {}, stop: async () => {}, dispose: async () => {} }) };
  return { temp, base, data, options, runtime, get prepared() { return prepared; }, clean: () => fs.rm(temp, { recursive: true, force: true }) };
}
test('pet releases require official Windows Chat portable asset and a digest', () => {
  assert.equal(selectPetRelease(release).version, '4.4.0');
  for (const changed of [{ ...release, prerelease: true }, { ...release, assets: [{ ...release.assets[0], digest: '' }] }, { ...release, assets: [{ ...release.assets[0], browser_download_url: 'https://elsewhere.invalid/file.zip' }] }]) assert.throws(() => selectPetRelease(changed));
});
test('pet update switches only after verification and preserves settings, visibility and next launch', async () => {
  const f = await fixture();
  try {
    const updater = createCompanionUpdater(f.options); await updater.check(); const result = await updater.update();
    assert.equal(result.status, 'updated'); assert.equal(f.runtime.isRunning(), true); assert.equal(f.runtime.isVisible(), false);
    assert.equal(await fs.readFile(path.join(f.data, 'desktop-pet/config.json'), 'utf8'), 'original settings');
    const selected = f.runtime.getDirectory(); assert.notEqual(selected, f.base);
    await f.runtime.stop(); f.runtime.setDirectory(f.base);
    await createCompanionUpdater(f.options).init(); assert.equal(f.runtime.getDirectory(), selected);
  } finally { await f.clean(); }
});
test('tampered downloads never prepare or stop the installed pet', async () => {
  const f = await fixture();
  try {
    const updater = createCompanionUpdater({ ...f.options, fetcher: async url => url.includes('/releases/latest') ? Response.json(release) : new Response('bad bytes') });
    await updater.check(); assert.equal((await updater.update()).status, 'error'); assert.equal(f.prepared, 0); assert.equal(f.runtime.isRunning(), true); assert.equal(f.runtime.getDirectory(), f.base);
  } finally { await f.clean(); }
});
test('failed activation restores prior config and runtime after a successful isolated probe', async () => {
  const f = await fixture(); const originalStart = f.runtime.start;
  f.runtime.start = async () => { if (f.runtime.getDirectory() !== f.base) { await fs.writeFile(path.join(f.data, 'desktop-pet/config.json'), 'migrated'); throw new Error('candidate failed'); } return originalStart(); };
  try {
    const updater = createCompanionUpdater(f.options); await updater.check(); const result = await updater.update();
    assert.equal(result.status, 'error'); assert.equal(f.runtime.getDirectory(), f.base); assert.equal(f.runtime.isRunning(), true);
    assert.equal(await fs.readFile(path.join(f.data, 'desktop-pet/config.json'), 'utf8'), 'original settings');
    await assert.rejects(fs.access(path.join(f.data, 'companion-updates/transaction.json')));
  } finally { await f.clean(); }
});
