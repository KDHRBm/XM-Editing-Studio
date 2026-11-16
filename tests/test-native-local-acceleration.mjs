import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('native local deployment distinguishes AMD hardware from actual GPU model residency', { skip: process.platform !== 'win32' }, async () => {
  const folder = path.resolve('.generated/tests/local-acceleration');
  await fs.mkdir(folder, { recursive: true });
  const exe = path.join(folder, 'LocalAccelerationTests.exe');
  const sources = ['app/native-host/Infrastructure.cs', 'app/native-host/LocalModels.cs', 'app/native-host/LocalHardware.cs', 'tests/NativeLocalAccelerationTests.cs'];
  for (const extra of ['app/native-host/LocalAcceleration.cs', 'app/native-host/LocalGpuHardware.cs']) {
    try { await fs.access(extra); sources.push(extra); } catch {}
  }
  const refs = ['System.Core.dll', 'System.Web.Extensions.dll', 'System.Net.Http.dll', 'System.Management.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll'];
  const built = spawnSync(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/utf8output', '/codepage:65001', '/platform:x64', '/out:' + exe, ...refs.map(r => '/r:' + r), ...sources.map(s => path.resolve(s))], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const run = spawnSync(exe, [], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /PASS/);
});
