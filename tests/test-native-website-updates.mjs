import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('native website updater selects compatible patches, handles offline checks and safely extracts ZIPs', {skip:process.platform!=='win32'}, async()=>{
  const directory=await fs.mkdtemp(path.resolve('.generated/tests/website-updates-'));
  const exe=path.join(directory,'verify.exe');
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const args=['/nologo','/utf8output','/codepage:65001','/platform:x64','/out:'+exe,...['System.Core.dll','System.Web.Extensions.dll','System.Net.Http.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll'].map(name=>'/reference:'+name),...['app/native-host/Infrastructure.cs','app/native-host/WebsiteUpdates.cs','tests/NativeWebsiteUpdatesTests.cs'].map(file=>path.resolve(file))];
  const built=spawnSync(compiler,args,{encoding:'utf8',windowsHide:true});
  assert.equal(built.status,0,built.stdout+built.stderr);
  const run=spawnSync(exe,[directory],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(run.status,0,run.stdout+run.stderr);
  console.log(run.stdout.trim());
});
