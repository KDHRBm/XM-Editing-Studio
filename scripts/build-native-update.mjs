import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createPackage,getRawHeader} from '@electron/asar';
const [stageArg,outputArg,nsisArg]=process.argv.slice(2);
if(!stageArg||!outputArg||!nsisArg) throw Error('Usage: node scripts/build-native-update.mjs native-stage output-dir makensis.exe');
const stage=path.resolve(stageArg),output=path.resolve(outputArg),bundle=path.join(output,'bundle');
const run=(exe,args)=>{const r=spawnSync(exe,args,{stdio:'inherit',windowsHide:true});if(r.status!==0)throw Error('Build command failed: '+exe);};
await fs.mkdir(bundle,{recursive:true});
const destination=path.join(bundle,'payload');
let previous={files:{}};try{previous=JSON.parse(await fs.readFile(path.join(destination,'native-files.json'),'utf8'));}catch{}
const manifest=JSON.parse(await fs.readFile(path.join(stage,'native-files.json'),'utf8'));
for(const [name,hash] of Object.entries(manifest.files)) {
  const file=path.resolve(destination,name);
  if(!file.startsWith(destination+path.sep))throw Error('Invalid payload path');
  if(previous.files[name]!==hash){await fs.mkdir(path.dirname(file),{recursive:true});await fs.copyFile(path.join(stage,name),file);}
}
for(const name of Object.keys(previous.files))if(!(name in manifest.files)){
  const file=path.resolve(destination,name);if(!file.startsWith(destination+path.sep))throw Error('Invalid previous path');await fs.rm(file,{force:true});
}
await fs.copyFile(path.join(stage,'native-files.json'),path.join(destination,'native-files.json'));
await fs.copyFile('packaging/update/Install-Native.ps1',path.join(bundle,'Install-Native.ps1'));
const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
run(compiler,['/nologo','/utf8output','/codepage:65001','/target:exe','/platform:x64','/reference:System.Web.Extensions.dll','/out:'+path.join(bundle,'MigrationHelper.exe'),path.resolve('packaging/update/MigrationHelper.cs')]);
const migration=path.join(bundle,'migration'),source=path.join(output,'migration-source');await fs.mkdir(source,{recursive:true});await fs.mkdir(migration,{recursive:true});
await fs.copyFile('scripts/export-legacy-state.cjs',path.join(source,'main.cjs'));
await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'xm-storage-migration',version:'1.4.2',main:'main.cjs'}));
await createPackage(source,path.join(migration,'app.asar'));
await fs.writeFile(path.join(migration,'header.sha256'),createHash('sha256').update(getRawHeader(path.join(migration,'app.asar')).headerString).digest('hex'));
const setup=path.join(output,'XM-Editing-Studio-1.4.2-Windows-x64-Setup.exe');
const config=path.resolve('packaging/update/native-config.nsh');
try {
  await fs.writeFile(config,'\ufeff'+[`!define OUTPUT_FILE "${setup}"`,`!define BUNDLE_DIR "${bundle}"`,`!define APP_ICON "${path.resolve('app/assets/app-icon.ico')}"`].join('\n'));
  run(path.resolve(nsisArg),['/V2','/INPUTCHARSET','UTF8',path.resolve('packaging/update/native-setup.nsi')]);
} finally {await fs.rm(config,{force:true});}
const digest=createHash('sha256').update(await fs.readFile(setup)).digest('hex');
await fs.writeFile(path.join(output,'SHA256SUMS.txt'),`${digest}  ${path.basename(setup)}\n`);
console.log(JSON.stringify({setup,sha256:digest,bytes:(await fs.stat(setup)).size}));
