import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const args=process.argv.slice(2), engineIndex=args.indexOf('--jianying');
const engineArg=engineIndex<0?null:args.splice(engineIndex,2)[1];
if(engineIndex>=0&&!engineArg)throw Error('--jianying requires a directory with JianYingEngine.exe and engine.json');
const stageIndex=args.indexOf('--stage');
const stageArg=stageIndex<0?null:args.splice(stageIndex,2)[1];
if(stageIndex>=0&&!stageArg)throw Error('--stage requires a complete native build directory');
const baseVersionIndex=args.indexOf('--base-version');
const baseVersionArg=baseVersionIndex<0?'1.4.2':args.splice(baseVersionIndex,2)[1];
if(!/^\d+\.\d+\.\d+$/.test(baseVersionArg))throw Error('--base-version requires a version such as 1.4.8');
const priorInstallIndex=args.indexOf('--prior-install');
const priorInstallArg=priorInstallIndex<0?null:args.splice(priorInstallIndex,2)[1];
if(priorInstallIndex>=0&&!priorInstallArg)throw Error('--prior-install requires an installed native application directory');
const [baseArg, hostArg, clientArg, outArg, ...priorManifestArgs] = args;
if (!outArg) throw Error('Usage: node scripts/build-native-patch.mjs baseline-app new-host new-client output [known-prior-native-files.json ...] [--base-version 1.4.8] [--stage complete-native-build] [--prior-install installed-app] [--jianying new-engine-directory]');
const base=path.resolve(baseArg), host=path.resolve(hostArg), client=path.resolve(clientArg), output=path.resolve(outArg);
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const baselineBytes=await fs.readFile(path.join(base,'native-files.json'));
const baseline=JSON.parse(baselineBytes);
if(baseline.version!==baseVersionArg||baseline.architecture!=='csharp-webview2') throw Error('Expected original native '+baseVersionArg+' baseline');
const priorInstall=priorInstallArg?path.resolve(priorInstallArg):null;
const priorManifestBytes=await Promise.all([...priorManifestArgs.map(file=>path.resolve(file)),...(priorInstall?[path.join(priorInstall,'native-files.json')]:[])].map(file=>fs.readFile(file)));
const priorManifests=priorManifestBytes.map(bytes=>JSON.parse(bytes));
await fs.mkdir(output); const payload=path.join(output,'payload'); await fs.mkdir(payload);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const candidates=new Map([['小马剪辑台.exe',await fs.readFile(host)]]);
if(engineArg) {
  const engine=await fs.readFile(path.resolve(engineArg,'JianYingEngine.exe'));
  const descriptor=await fs.readFile(path.resolve(engineArg,'engine.json'));
  if(JSON.parse(descriptor).sha256!==hash(engine))throw Error('JianYing engine descriptor checksum mismatch');
  candidates.set('resources/jianying/JianYingEngine.exe',engine);
  candidates.set('resources/jianying/engine.json',descriptor);
}
async function walk(directory) {
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error('Linked source');
    if(entry.isDirectory())await walk(file);
    else candidates.set('resources/client/'+path.relative(client,file).replaceAll('\\','/'),await fs.readFile(file));
  }
}
await walk(client);
if(stageArg) {
  const stage=path.resolve(stageArg);
  const stageManifest=JSON.parse(await fs.readFile(path.join(stage,'native-files.json'),'utf8'));
  if(stageManifest.version!==version||stageManifest.architecture!==baseline.architecture)throw Error('Complete native build has the wrong version or architecture');
  candidates.clear();
  for(const [name,digest] of Object.entries(stageManifest.files)) {
    if(name.startsWith('data/'))continue;
    const file=path.resolve(stage,name);
    if(!file.startsWith(stage+path.sep))throw Error('Invalid native build path: '+name);
    const bytes=await fs.readFile(file);
    if(hash(bytes)!==digest)throw Error('Native build checksum mismatch: '+name);
    candidates.set(name,bytes);
  }
} else {
  const nativeManifest=JSON.parse((await fs.readFile(path.join(base,'resources/native-manifest.json'),'utf8')).replace(/^\uFEFF/,''));
  nativeManifest.version=version;
  candidates.set('resources/native-manifest.json',Buffer.from(JSON.stringify(nativeManifest,null,2)));
}
const programFiles=Object.fromEntries(Object.entries(baseline.files).filter(([name])=>!name.startsWith('data/')));
const installedFiles={};
if(priorInstall) {
  const installed=priorManifests.at(-1);
  if(installed.version!==baseVersionArg||installed.architecture!==baseline.architecture)throw Error('Prior installation has the wrong version or architecture');
  for(const name of Object.keys(programFiles)) {
    try { installedFiles[name]=hash(await fs.readFile(path.join(priorInstall,name))); }
    catch(error) { if(error.code!=='ENOENT')throw error; installedFiles[name]=''; }
  }
  for(const name of Object.keys(programFiles)) if(!candidates.has(name)&&installedFiles[name]!==programFiles[name]) {
    const bytes=await fs.readFile(path.join(base,name));
    if(hash(bytes)!==programFiles[name])throw Error('Baseline modified: '+name);
    candidates.set(name,bytes);
  }
}
const finalFiles={...programFiles},changed=[];
async function add(name,bytes,before,force=false) {
  const after=hash(bytes);if(after===before&&!force)return;
  const destination=path.join(payload,name);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);
  changed.push({name,before:before||'',after});
}
for(const [name,bytes] of candidates) {
  if(baseline.files[name] && hash(await fs.readFile(path.join(base,name)))!==baseline.files[name])throw Error('Baseline modified: '+name);
  await add(name,bytes,baseline.files[name],priorManifests.some(prior=>prior.files[name]!==baseline.files[name])||installedFiles[name]&&installedFiles[name]!==baseline.files[name]);finalFiles[name]=hash(bytes);
}
await add('native-files.json',Buffer.from(JSON.stringify({...baseline,version,files:finalFiles},null,2)),hash(await fs.readFile(path.join(base,'native-files.json'))));
const retained=Object.fromEntries(Object.entries(programFiles).filter(([name])=>!changed.some(file=>file.name===name)&&(!name.startsWith('resources/companion/') || ['resources/companion/xm-manifest.json','resources/companion/dsh-pet-standalone-webm-chat.exe'].includes(name))));
for(const [name,digest] of Object.entries(retained)) if(hash(await fs.readFile(path.join(base,name)))!==digest) throw Error('Retained baseline changed: '+name);
const baselines=[];
for(const bytes of [baselineBytes,...priorManifestBytes]) {
  const prior=JSON.parse(bytes);
  const actual=priorInstall&&bytes===priorManifestBytes.at(-1)?installedFiles:null;
  const number=value=>/^\d+\.\d+\.\d+$/.test(value)?value.split('.').reduce((sum,part)=>sum*100000+Number(part),0):NaN;
  if(!Number.isFinite(number(prior.version))||number(prior.version)<number(baseline.version)||number(prior.version)>number(version)||prior.architecture!==baseline.architecture)throw Error('Unsupported prior native manifest');
  for(const [name,digest] of Object.entries(retained))if((actual&&Object.hasOwn(actual,name)?actual[name]:prior.files[name])!==digest)throw Error('Prior build requires additional component payload: '+name);
  const files=Object.fromEntries(changed.map(file=>[file.name,file.name==='native-files.json'?hash(bytes):actual&&Object.hasOwn(actual,file.name)?actual[file.name]:prior.files[file.name]||'']));
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
await fs.writeFile(path.join(output,'使用说明.txt'),'XM剪辑台 '+version+' 增量更新包\r\n适用：原版 '+[...new Set(baselines.map(item=>item.version))].join('、')+'（C# + WebView2）\r\n\r\n1. 将整个 ZIP 解压到安装目录之外，保持更新器 EXE 与 payload 文件夹同级。\r\n2. 不要单独移动更新器 EXE，也不要运行 payload\\小马剪辑台.exe；它不是独立程序。\r\n3. 保存任务，从托盘彻底退出 XM剪辑台。\r\n4. 双击外层的 XM-Editing-Studio-'+version+'-Update.exe，选择原版安装目录并点击开始更新。\r\n5. 已安装本次修改时，会提示无需重复更新。\r\n\r\n程序自动校验和备份，保留配置、任务与音乐。备份位于安装目录 .xiaoma-update-backups。\r\n此包不是完整安装包；旧版请先更新至 '+baseline.version+'。请勿混用其他版本文件。\r\n');
console.log(JSON.stringify({output,version,changed:changed.map(file=>file.name),baselines:baselines.map(item=>item.version),retained:Object.keys(retained).length},null,2));
