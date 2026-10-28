import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompanionSettingsStore } from '../app/electron/companion-settings.mjs';

test('companion appearance and motion survive restart; simultaneous updates retain both settings', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xm-companion-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'companion.json');
  const store = createCompanionSettingsStore(file);
  await Promise.all([
    store.update({ palette: 'original', size: 'large' }),
    store.update({ motion: false, roam: true, idleInterval: 25 }),
  ]);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.palette, 'original');
  assert.equal(saved.size, 'large');
  assert.equal(saved.motion, false);
  assert.equal(saved.roam, true);
  assert.equal(saved.idleInterval, 25);
  assert.deepEqual(await createCompanionSettingsStore(file).load(), saved);
  assert.equal(await readFile(`${file}.tmp`, 'utf8').catch(() => null), null);
});

test('companion settings recover from invalid saved data and bound numeric controls', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xm-companion-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'companion.json');
  await writeFile(file, '{broken');
  const store = createCompanionSettingsStore(file);
  assert.equal((await store.load()).palette, 'original');
  assert.throws(() => store.update({ unexpected: true }), /无效/);
  const saved = await store.update({ volume: 120, idleInterval: 2, palette: 'original' });
  assert.equal(saved.volume, 100);
  assert.equal(saved.idleInterval, 10);
  assert.equal(saved.palette, 'original');
});
