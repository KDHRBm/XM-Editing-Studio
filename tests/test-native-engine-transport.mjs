import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('C# host sends exact UTF-8 JSON to native workers on a Chinese Windows code page', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-engine-transport-'));
  try {
    const exe = path.join(directory, 'transport.exe');
    const compilation = spawnSync(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
      '/nologo', '/utf8output', '/codepage:65001', '/target:exe', '/platform:x64', '/r:System.Web.Extensions.dll', '/out:' + exe,
      path.resolve('app/native-host/Infrastructure.cs'), path.resolve('tests/NativeEngineTransportTests.cs'),
    ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);
    const result = spawnSync(exe, [], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /UTF-8 worker transport passed/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
