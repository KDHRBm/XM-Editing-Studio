import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoUpdater } from '../app/electron/auto-updater.mjs';

const setup = 'XM-Editing-Studio-1.4.1-Windows-x64-Setup.exe';
const release = { tag_name: 'v1.4.1', html_url: 'https://github.com/KDHRBm/XM-Editing-Studio/releases/tag/v1.4.1', assets: [
  { name: 'XM-Editing-Studio-1.4.1-Windows-x64-Update.exe', browser_download_url: 'https://example.com/update' },
  { name: setup, browser_download_url: 'https://example.com/setup' },
  { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.com/sums' },
] };
test('updater checks the owner repository and selects the full installer', async () => {
  const urls = [];
  const fetcher = async url => {
    urls.push(url);
    return url.includes('/releases/latest') ? { ok: true, json: async () => release }
      : { ok: true, text: async () => `${'a'.repeat(64)}  ${setup}\n` };
  };
  const updater = createAutoUpdater({ currentVersion: '1.4.0', downloadDirectory: 'unused', fetcher });
  const state = await updater.check();
  assert.equal(urls[0], 'https://api.github.com/repos/KDHRBm/XM-Editing-Studio/releases/latest');
  assert.equal(state.assetName, setup);
  assert.equal(state.expectedSha256, 'a'.repeat(64));
  assert.equal(state.status, 'available');
});
test('updater refuses a package without a published checksum', async () => {
  const fetcher = async url => url.includes('/releases/latest')
    ? { ok: true, json: async () => release }
    : { ok: false, status: 404 };
  const updater = createAutoUpdater({ currentVersion: '1.4.0', downloadDirectory: 'unused', fetcher });
  await updater.check();
  await assert.rejects(updater.download(), /SHA-256/);
});
