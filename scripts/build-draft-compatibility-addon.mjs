// Produces a local optional runtime add-on from the user's verified component cache.
// Binary components are not committed to the source repository by this tool.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const [sourceArg,outputArg]=process.argv.slice(2);
if(!sourceArg||!outputArg)throw Error('Usage: node scripts/build-draft-compatibility-addon.mjs verified-runtime-directory new-output-directory');
const source=path.resolve(sourceArg),output=path.resolve(outputArg);
const original=JSON.parse(await fs.readFile(path.join(source,'runtime.json'),'utf8'));
if(original.version!=='11.6.5.14523'||!original.files?.['videoeditor.dll'])throw Error('Expected verified 11.6.5.14523 component cache');
const manifest={version:original.version,files:original.files};
await fs.mkdir(output);await fs.mkdir(path.join(output,'runtime'));
for(const [name,expected] of Object.entries(manifest.files)){
  if(!name||name!==path.basename(name)||/[\\/:]/.test(name))throw Error('Invalid component name');
  const stat=await fs.lstat(path.join(source,name));if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid component source');
  const bytes=await fs.readFile(path.join(source,name));
  if(bytes.length!==expected.size||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('Source checksum failed: '+name);
  await fs.writeFile(path.join(output,'runtime',name),bytes);
}
const spec=path.join(output,'runtime','runtime.json');await fs.writeFile(spec,JSON.stringify(manifest,null,2));
const exe=path.join(output,'XM-字幕兼容组件安装.exe');
const compiled=spawnSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/utf8output','/codepage:65001','/target:winexe','/platform:x64','/optimize+','/reference:System.Web.Extensions.dll','/reference:System.Windows.Forms.dll','/resource:'+spec+',runtime-spec.json','/win32icon:'+path.resolve('app/assets/app-icon.ico'),'/out:'+exe,path.resolve('packaging/compatibility/DraftCompatibilityInstaller.cs')],{encoding:'utf8',windowsHide:true});
if(compiled.status!==0)throw Error(compiled.stdout+compiled.stderr);
const verified=spawnSync(exe,['--verify'],{encoding:'utf8',windowsHide:true,timeout:120000});
if(verified.status!==0)throw Error(verified.stdout+verified.stderr);
await fs.writeFile(path.join(output,'使用说明.txt'),`XM剪辑台字幕兼容组件（11.6.5 / 11.7.5）\r\n\r\n适用：C# 版 XM剪辑台 1.4.2 及以后。用于只有剪映 11.7.5、字幕提取出现“错误 6 / 未检测到兼容组件”的电脑。\r\n\r\n1. 将压缩包完整解压，保留 runtime 文件夹与安装工具相邻。\r\n2. 双击 XM-字幕兼容组件安装.exe，选择 XM剪辑台的安装目录（不是剪映目录）。\r\n3. 安装成功后重新打开 XM剪辑台。完全退出剪映，再执行字幕提取并隐藏轨道。\r\n\r\n组件仅写入 XM剪辑台安装目录的 data/draft-compat/11.6.5.14523，不替换剪映，不改变剪映安装版本，不修改草稿版本。不包含个人配置或草稿。\r\n已有相同组件时无需重复安装；替换旧组件时先备份到 .xiaoma-update-backups。\r\n不要单独复制 videoeditor.dll，它依赖整套组件。\r\n\r\n已用 11.6.5 和 11.7.5 样本验证读取及字幕写回；如果完整组件安装后仍失败，请保留 attachment_pc_common.json、draft_content.json 与 Timelines 文件夹进一步检查。此组件不保证所有后续草稿格式通用。\r\n`);
console.log(JSON.stringify({output,files:Object.keys(manifest.files).length,bytes:Object.values(manifest.files).reduce((sum,file)=>sum+file.size,0),payloadVerified:true},null,2));
