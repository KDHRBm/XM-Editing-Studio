import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { APP_PORT, resolveUserDataDirectory } from '../app/electron/profile-config.mjs';

const appData = path.resolve('.generated/tests/test-roaming');
const legacy = path.join(appData, '黑曜信号台');
const current = path.join(appData, 'xiaoma-editing-studio');
test('existing installation retains profile and local-storage origin', () => {
  assert.equal(resolveUserDataDirectory(appData, '', value => value === legacy), legacy);
  assert.equal(APP_PORT, 37651);
});
test('fresh installation uses the new product profile', () => {
  assert.equal(resolveUserDataDirectory(appData, '', () => false), current);
});
test('existing new product profile remains selected', () => {
  assert.equal(resolveUserDataDirectory(appData, '', () => true), current);
});
test('explicit test profile cannot open either real user profile', () => {
  const isolated = path.resolve('.generated/tests/isolated-test-profile');
  assert.equal(resolveUserDataDirectory(appData, isolated, () => true), isolated);
});
