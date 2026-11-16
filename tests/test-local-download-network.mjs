import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';

test('local Ollama launch carries the selected Windows HTTPS proxy into the child process',async()=>{
  const source=await fs.readFile('app/native-host/LocalModels.cs','utf8');
  const start=source.slice(source.indexOf('private async Task StartLocalModelServer()'),source.indexOf('private async Task PullLocalModel('));
  assert.match(start,/LocalModelNetwork\.Configure\(info/,'Ollama child process currently misses Windows system proxy');
});

test('native download network policy preserves user routes, bypasses loopback and explains Fake-IP',{skip:process.platform!=='win32'},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'xm-model-proxy-'));
  try{
    const exe=path.join(root,'verify.exe');
    const compiled=spawnSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/utf8output','/codepage:65001','/platform:x64','/out:'+exe,'/reference:System.dll','/reference:System.Core.dll',path.resolve('app/native-host/LocalModelNetwork.cs'),path.resolve('tests/NativeLocalModelNetworkTests.cs')],{encoding:'utf8',windowsHide:true});
    assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
    const result=spawnSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:10000});
    assert.equal(result.status,0,result.stdout+result.stderr);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
