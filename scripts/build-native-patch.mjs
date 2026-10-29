import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const [baseArg, hostArg, clientArg, outArg, ...priorManifestArgs] = process.argv.slice(2);
if (!outArg) throw Error('Usage: node scripts/build-native-patch.mjs baseline-app new-host new-client output [known-prior-native-files.json ...]');
const base=path.resolve(baseArg), host=path.resolve(hostArg), client=path.resolve(clientArg), output=path.resolve(outArg);
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const baselineBytes=await fs.readFile(path.join(base,'native-files.json'));
const baseline=JSON.parse(baselineBytes);
if(baseline.version!=='1.4.2'||baseline.architecture!=='csharp-webview2') throw Error('Expected original native 1.4.2 baseline');
await fs.mkdir(output); const payload=path.join(output,'payload'); await fs.mkdir(payload);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const candidates=new Map([['小马剪辑台.exe',await fs.readFile(host)]]);
async function walk(directory) {
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error('Linked source');
    if(entry.isDirectory())await walk(file);
    else candidates.set('resources/client/'+path.relative(client,file).replaceAll('\\','/'),await fs.readFile(file));
  }
}
await walk(client);
const nativeManifest=JSON.parse(await fs.readFile(path.join(base,'resources/native-manifest.json'),'utf8'));
nativeManifest.version=version;
candidates.set('resources/native-manifest.json',Buffer.from(JSON.stringify(nativeManifest,null,2)));
const finalFiles={...baseline.files},changed=[];
async function add(name,bytes,before) {
  const after=hash(bytes);if(after===before)return;
  const destination=path.join(payload,name);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);
  changed.push({name,before:before||'',after});
}
for(const [name,bytes] of candidates) {
  if(baseline.files[name] && hash(await fs.readFile(path.join(base,name)))!==baseline.files[name])throw Error('Baseline modified: '+name);
  await add(name,bytes,baseline.files[name]);finalFiles[name]=hash(bytes);
}
await add('native-files.json',Buffer.from(JSON.stringify({...baseline,version,files:finalFiles},null,2)),hash(await fs.readFile(path.join(base,'native-files.json'))));
const retained=Object.fromEntries(Object.entries(baseline.files).filter(([name])=>!changed.some(file=>file.name===name)&&(!name.startsWith('resources/companion/') || ['resources/companion/xm-manifest.json','resources/companion/dsh-pet-standalone-webm-chat.exe'].includes(name))));
for(const [name,digest] of Object.entries(retained)) if(hash(await fs.readFile(path.join(base,name)))!==digest) throw Error('Retained baseline changed: '+name);
const baselines=[];
for(const bytes of [baselineBytes,...await Promise.all(priorManifestArgs.map(file=>fs.readFile(path.resolve(file))))]) {
  const prior=JSON.parse(bytes);
  if(![baseline.version,version].includes(prior.version)||prior.architecture!==baseline.architecture)throw Error('Unsupported prior native manifest');
  for(const [name,digest] of Object.entries(retained))if(prior.files[name]!==digest)throw Error('Prior build requires additional component payload: '+name);
  const files=Object.fromEntries(changed.map(file=>[file.name,file.name==='native-files.json'?hash(bytes):prior.files[file.name]||'']));
  if(!baselines.some(item=>item.version===prior.version&&JSON.stringify(item.files)===JSON.stringify(files)))baselines.push({version:prior.version,files});
}
const manifest={version,baseVersion:baseline.version,marker:'xiaoma-editing-studio-482e9a36-9698-45e1-b24e-d2e8d9042885',changed,retained,baselines};
const manifestFile=path.join(path.dirname(output),'patch-manifest.json');await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2));
const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const common=['/nologo','/utf8output','/codepage:65001','/platform:x64','/optimize+','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll',
  '/resource:'+manifestFile+',patch.json'];
for(const [exe,args] of [[path.join(output,'XM-Editing-Studio-'+version+'-Update.exe'),['/target:winexe','/win32icon:'+path.resolve('app/assets/app-icon.ico')]],
  [path.join(path.dirname(output),'Update-Test.exe'),['/target:exe','/define:UPDATE_TEST']]]) {
  const result=spawnSync(compiler,[...common,...args,'/out:'+exe,path.resolve('packaging/update/NativePatchUpdater.cs')],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw Error(result.stdout+result.stderr);
}
await fs.copyFile('CHANGELOG-'+version+'.md',path.join(output,'更新说明.md'));
await fs.writeFile(path.join(output,'使用说明.txt'),'XM剪辑台 '+version+' 小更新包\r\n适用：原版 1.4.2，以及此前发布和本机更新的 1.4.3（C# + WebView2）\r\n\r\n1. 将整个压缩包解压到安装目录之外。不要只取出 exe。\r\n2. 保存任务，从托盘彻底退出 XM剪辑台和桌宠。\r\n3. 双击 XM-Editing-Studio-'+version+'-Update.exe，选择原版安装目录并点击开始更新。\r\n4. 已安装本次修改时，会提示无需重复更新。\r\n\r\n程序自动校验和备份，保留配置、任务、音乐与桌宠。备份位于安装目录 .xiaoma-update-backups。\r\n此包不是完整安装包；1.3.1 等旧版请先更新至 1.4.2。请勿混用其他版本文件。\r\n');
console.log(JSON.stringify({output,version,changed:changed.map(file=>file.name),baselines:baselines.map(item=>item.version),retained:Object.keys(retained).length},null,2));
