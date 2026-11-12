import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('draft punctuation restoration preserves styles/timing and rejects stale or partial writes', {skip:process.platform!=='win32'}, async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xm-punctuation-check-'));
  try {
    const exe=path.join(dir,'verify.exe');
    const files=['JianYingEngine','JianYingScan','JianYingProgress','JianYingAutomation','JianYingDraftIO','JianYingPunctuation','JianYingSubtitleSplit'].map(n=>'app/native/'+n+'.cs');
    const compiled=spawnSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/utf8output','/codepage:65001','/platform:x64','/main:JianYingPunctuationTests','/r:System.Web.Extensions.dll','/r:System.Drawing.dll','/r:System.Windows.Forms.dll','/out:'+exe,...[...files,'tests/JianYingPunctuationTests.cs'].map(p=>path.resolve(p))],{encoding:'utf8',windowsHide:true});
    assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
    const result=spawnSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:20000});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.match(result.stdout,/Punctuation checks passed:/);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
