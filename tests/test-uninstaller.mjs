import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('independent uninstaller recognizes original install and preserves personal files', {skip:process.platform!=='win32'}, async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'xm-uninstall-'));
  const source=path.resolve('packaging/uninstaller/XmUninstaller.cs');
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const exe=path.join(root,'test-uninstaller.exe');
  const built=spawnSync(compiler,['/nologo','/utf8output','/codepage:65001','/target:exe','/define:UNINSTALL_TEST','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/out:'+exe,source],{encoding:'utf8',windowsHide:true});
  try{
    assert.equal(built.status,0,built.stdout+built.stderr);
    const run=(command,dir)=>spawnSync(exe,[command,dir],{encoding:'utf8',windowsHide:true,timeout:15000});
    const fixture=async(name,files={})=>{
      const dir=path.join(root,name);
      await fs.mkdir(path.join(dir,'resources/client'),{recursive:true});
      await fs.mkdir(path.join(dir,'data'),{recursive:true});
      await fs.writeFile(path.join(dir,'xiaoma-install.id'),'xiaoma-editing-studio-482e9a36-9698-45e1-b24e-d2e8d9042885');
      await fs.writeFile(path.join(dir,'小马剪辑台.exe'),'program');
      await fs.writeFile(path.join(dir,'resources/client/index.html'),'interface');
      await fs.writeFile(path.join(dir,'data/projects.json'),'keep me');
      await fs.writeFile(path.join(dir,'personal.txt'),'keep me too');
      await fs.writeFile(path.join(dir,'native-files.json'),JSON.stringify({version:'1.6.1',architecture:'csharp-webview2',files:{'小马剪辑台.exe':'sha','resources/client/index.html':'sha',...files}}));
      return dir;
    };
    const installed=await fixture('original');
    const inspect=run('--inspect',installed);
    assert.equal(inspect.status,0,inspect.stderr);
    assert.match(inspect.stdout,/original\|1\.6\.1\|2/);
    const fork=await fixture('fork-copy');
    await fs.writeFile(path.join(fork,'xm-fork-install.id'),'fork');
    assert.equal(run('--inspect',fork).status,1,'fork directories rejected');
    const attacked=await fixture('bad-path',{'../personal.txt':'sha'});
    assert.equal(run('--inspect',attacked).status,1,'escaping manifest rejected');
    const data=await fixture('bad-data',{'data/projects.json':'sha'});
    assert.equal(run('--inspect',data).status,1,'user data may not enter manifest');
    const output=run('--remove-test',installed);
    assert.equal(output.status,0,output.stderr);
    await assert.rejects(fs.access(path.join(installed,'小马剪辑台.exe')));
    await assert.rejects(fs.access(path.join(installed,'native-files.json')));
    await assert.rejects(fs.access(path.join(installed,'xiaoma-install.id')));
    assert.equal(await fs.readFile(path.join(installed,'data/projects.json'),'utf8'),'keep me');
    assert.equal(await fs.readFile(path.join(installed,'personal.txt'),'utf8'),'keep me too');
    assert.equal(run('--inspect',installed).status,1,'uninstalled directory no longer detected');
    const archive=await fixture('archive-original');
    const archived=run('--archive-test',archive);
    assert.equal(archived.status,0,archived.stderr);
    await assert.rejects(fs.access(path.join(archive,'data')));
    assert.equal(await fs.readFile(path.join(archive,'personal.txt'),'utf8'),'keep me too');
    const backup=(await fs.readdir(root)).find(name=>name.startsWith('archive-original-data-backup-'));
    assert.ok(backup,'data backup created next to installation');
    assert.equal(await fs.readFile(path.join(root,backup,'projects.json'),'utf8'),'keep me');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
