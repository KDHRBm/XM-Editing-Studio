import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPeriodHelper } from '../app/scripts/verify-native-helper.mjs';

test('native build verification accepts the matching helper and refuses stale or missing update payloads', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xm-helper-integrity-'));
  const helper = path.join(root, 'PeriodKeeper.exe'), manifest = path.join(root, 'period-helper-integrity.mjs');
  try {
    const bytes = Buffer.from('native-helper-fixture'), sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(helper, bytes);
    await writeFile(manifest, `export const HELPER_SHA256 = '${sha256}';\n`);
    assert.deepEqual(await verifyPeriodHelper(helper, manifest), { sha256, bytes: bytes.length });
    await writeFile(helper, 'previous-helper-fixture');
    await assert.rejects(verifyPeriodHelper(helper, manifest), /不匹配.*不能继续发布/);
    await assert.rejects(verifyPeriodHelper(path.join(root, 'absent.exe'), manifest), /缺少标点组件/);
    await writeFile(manifest, "export const HELPER_SHA256 = '';\n");
    await assert.rejects(verifyPeriodHelper(helper, manifest), /清单无效/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
