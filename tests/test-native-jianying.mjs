import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('native JianYing engine preserves scope, capture, progress and rename safety', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-native-harness-'));
  try {
    const exe = path.join(dir, 'checks.exe');
    const compile = spawnSync(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
      '/nologo', '/utf8output', '/codepage:65001', '/target:exe', '/platform:x64', '/main:JianYingNativeTests',
      '/r:System.Web.Extensions.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/out:' + exe,
      ...['app/native/JianYingEngine.cs', 'app/native/JianYingScan.cs', 'app/native/JianYingProgress.cs', 'app/native/JianYingDraftIO.cs', 'tests/JianYingNativeTests.cs'].map(file => path.resolve(file)),
    ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const result = spawnSync(exe, [], { encoding: 'utf8', windowsHide: true, timeout: 12000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /checks passed: /);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
