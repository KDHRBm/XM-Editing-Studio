import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('runtime source detection and downloads recover from timeouts without bypassing integrity or cancellation', { skip: process.platform !== 'win32' }, async () => {
  const folder = path.resolve('.generated/tests/local-runtime-download');
  await fs.mkdir(folder, { recursive: true });
  const exe = path.join(folder, 'LocalRuntimeDownloadTests.exe');
  const sources = ['app/native-host/Infrastructure.cs', 'app/native-host/LocalRuntimeDownload.cs', 'tests/NativeLocalRuntimeDownloadTests.cs'];
  const compiled = spawnSync(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/utf8output', '/codepage:65001', '/platform:x64', '/out:' + exe,
    '/r:System.Core.dll', '/r:System.Net.Http.dll', '/r:System.Web.Extensions.dll', ...sources.map(s => path.resolve(s))], { encoding: 'utf8', windowsHide: true });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const run = spawnSync(exe, [], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /PASS: 16 runtime download scenarios/);
});
