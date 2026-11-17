import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('voice host validates readiness, isolates operations, cancels owned process and retains models',{skip:process.platform!=='win32'},async()=>{
 const folder=path.resolve('.generated/tests/voice');await fs.mkdir(folder,{recursive:true});const exe=path.join(folder,'VoiceTests.exe');
 const sources=['app/native-host/Infrastructure.cs','app/native-host/VoiceStudio.cs','tests/NativeVoiceTests.cs'];
 const refs=['System.Core.dll','System.Web.Extensions.dll','System.Windows.Forms.dll','System.Drawing.dll'];
 const build=spawnSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/utf8output','/codepage:65001','/out:'+exe,...refs.map(r=>'/r:'+r),...sources.map(s=>path.resolve(s))],{encoding:'utf8',windowsHide:true});
 assert.equal(build.status,0,build.stdout+build.stderr);
 const run=spawnSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/PASS 16/);
});
