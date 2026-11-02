import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('Windows launchers and window share identity without changing other installations', {skip:process.platform!=='win32'}, async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'xm-shell-'));
  try {
    const exe=path.join(directory,'verify.exe');
    const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const built=spawnSync(compiler,['/nologo','/utf8output','/codepage:65001','/platform:x64','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/out:'+exe,
      ...['app/native-host/ShellIdentity.cs','app/native-host/RoundedWindow.cs','app/native-host/StudioWindow.cs','tests/NativeShellIdentityTests.cs'].map(file=>path.resolve(file))],{encoding:'utf8',windowsHide:true});
    assert.equal(built.status,0,built.stdout+built.stderr);
    const run=spawnSync(exe,[directory,path.resolve('app/assets/app-icon.ico')],{encoding:'utf8',windowsHide:true,timeout:20000});
    assert.equal(run.status,0,run.stdout+run.stderr);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));
    await fs.rm(directory,{recursive:true,force:true});
  }
});
