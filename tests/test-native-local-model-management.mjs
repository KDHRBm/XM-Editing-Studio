import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('native model management preserves shared files and guards live analysis and foreign services', {skip:process.platform !== 'win32'}, async()=>{
  const folder=path.resolve('.generated/tests/local-model-management');
  await fs.mkdir(folder,{recursive:true});
  const exe=path.join(folder,'LocalModelManagementTests.exe');
  const sources=['Infrastructure','LocalModels','LocalHardware','LocalAcceleration','LocalModelNetwork','LocalRuntimeDownload','LocalModelInventory','LocalModelManagement'].map(name=>`app/native-host/${name}.cs`);
  sources.push('tests/NativeLocalModelManagementTests.cs');
  const refs=['System.Core.dll','System.Web.Extensions.dll','System.Net.Http.dll','System.Management.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll'];
  const built=spawnSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/utf8output','/codepage:65001','/platform:x64','/out:'+exe,...refs.map(r=>'/r:'+r),...sources.map(s=>path.resolve(s))],{encoding:'utf8',windowsHide:true});
  assert.equal(built.status,0,built.stdout+built.stderr);
  const run=spawnSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(run.status,0,run.stdout+run.stderr);
  assert.match(run.stdout,/PASS/);
});
