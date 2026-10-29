import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('native music folder drops deduplicate and reject invalid selections atomically', {skip:process.platform !== 'win32'}, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-music-'));
  try {
    const exe = path.join(directory, 'verify.exe');
    const compile = spawnSync(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
      '/nologo', '/utf8output', '/codepage:65001', '/reference:System.Core.dll', '/out:' + exe,
      ...['app/native-host/MusicDirectories.cs', 'tests/NativeMusicDirectoriesTests.cs'].map(name => path.resolve(name))
    ], {encoding:'utf8', windowsHide:true});
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const run = spawnSync(exe, [], {encoding:'utf8', windowsHide:true, timeout:15000});
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally { await fs.rm(directory, {recursive:true, force:true}); }
});
