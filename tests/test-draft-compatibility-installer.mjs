import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('subtitle compatibility add-on verifies, installs atomically, preserves data and repairs incomplete runtime', {skip:process.platform!=='win32'},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'xm-compat-installer-'));
  try{
    const source=path.join(root,'runtime'),target=path.join(root,'studio');
    await fs.mkdir(source);await fs.mkdir(path.join(target,'resources/jianying'),{recursive:true});
    await fs.mkdir(path.join(target,'data'));
    await fs.writeFile(path.join(target,'data/user.json'),'user settings');
    await fs.writeFile(path.join(target,'native-files.json'),JSON.stringify({version:'1.4.4',architecture:'csharp-webview2'}));
    await fs.writeFile(path.join(target,'resources/jianying/JianYingEngine.exe'),'engine fixture');
    const files={};
    for(const name of ['videoeditor.dll','dependency.dll']){
      const bytes=Buffer.from('fixture '+name);await fs.writeFile(path.join(source,name),bytes);
      files[name]={size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    }
    const spec=path.join(root,'spec.json');await fs.writeFile(spec,JSON.stringify({version:'11.6.5.14523',files}));
    const exe=path.join(root,'installer.exe');
    const built=spawnSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/utf8output','/codepage:65001','/target:exe','/define:COMPAT_TEST','/reference:System.Web.Extensions.dll','/reference:System.Windows.Forms.dll','/out:'+exe,'/resource:'+spec+',runtime-spec.json',path.resolve('packaging/compatibility/DraftCompatibilityInstaller.cs')],{encoding:'utf8',windowsHide:true});
    assert.equal(built.status,0,built.stdout+built.stderr);
    const run=(...args)=>spawnSync(exe,args,{encoding:'utf8',windowsHide:true,timeout:20000});
    assert.equal(run('--verify').status,0);
    assert.equal(run('--install-test',root).status,1,'wrong target rejected');
    const first=run('--install-test',target);assert.equal(first.status,0,first.stderr);
    const dest=path.join(target,'data/draft-compat/11.6.5.14523');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dest,'runtime.json'),'utf8')).files,files);
    assert.equal(await fs.readFile(path.join(target,'data/user.json'),'utf8'),'user settings');
    assert.equal(run('--install-test',target).status,0,'repeat install is a no-op');
    await assert.rejects(fs.access(path.join(target,'.xiaoma-update-backups')));
    await fs.writeFile(path.join(source,'dependency.dll'),'corrupt');
    assert.equal(run('--install-test',target).status,1,'corrupt payload rejected before touching a good install');
    assert.equal(await fs.readFile(path.join(dest,'dependency.dll'),'utf8'),'fixture dependency.dll');
    await fs.writeFile(path.join(source,'dependency.dll'),'fixture dependency.dll');
    await fs.writeFile(path.join(dest,'dependency.dll'),'old broken dependency');
    assert.equal(run('--install-test',target).status,0);
    const backups=await fs.readdir(path.join(target,'.xiaoma-update-backups'));
    assert.equal(backups.length,1);
    assert.equal(await fs.readFile(path.join(target,'.xiaoma-update-backups',backups[0],'dependency.dll'),'utf8'),'old broken dependency');
    assert.equal(await fs.readFile(path.join(dest,'dependency.dll'),'utf8'),'fixture dependency.dll');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
