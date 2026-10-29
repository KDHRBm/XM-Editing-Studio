import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('native profile relocation and recursive companion drops preserve files', {skip:process.platform!=='win32'},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xm-native-data-'));
  try{
    const exe=path.join(dir,'verify.exe');
    const compiled=spawnSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/utf8output','/codepage:65001','/out:'+exe,...['app/native-host/DataPaths.cs','app/native-host/DropFiles.cs','tests/NativeDataDropTests.cs'].map(x=>path.resolve(x))],{encoding:'utf8',windowsHide:true});
    assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
    const run=spawnSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(run.status,0,run.stdout+run.stderr);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
