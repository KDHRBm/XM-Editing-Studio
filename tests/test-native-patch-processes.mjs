import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('patch updater stops only the selected installation and reports remaining processes', {skip:process.platform!=='win32'}, async()=>{
  await fs.mkdir('.generated/tests',{recursive:true});
  const directory=await fs.mkdtemp(path.resolve('.generated/tests/patch-processes-'));
  const manifest=path.join(directory,'patch.json');
  await fs.writeFile(manifest,JSON.stringify({version:'1.6.3',baseVersion:'1.6.1',marker:'patch-process-fixture',baselines:[{version:'1.6.2',files:{}}],changed:[],retained:{}}));
  const exe=path.join(directory,'verify.exe');
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const built=spawnSync(compiler,['/nologo','/utf8output','/codepage:65001','/platform:x64','/main:NativePatchProcessTests','/out:'+exe,'/resource:'+manifest+',patch.json',...['System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll'].map(n=>'/reference:'+n),...['packaging/update/NativePatchUpdater.cs','tests/NativePatchProcessTests.cs'].map(f=>path.resolve(f))],{encoding:'utf8',windowsHide:true});
  assert.equal(built.status,0,built.stdout+built.stderr);
  const run=spawnSync(exe,[directory],{encoding:'utf8',windowsHide:true,timeout:45000});
  assert.equal(run.status,0,run.stdout+run.stderr);
  console.log(run.stdout.trim());
});
