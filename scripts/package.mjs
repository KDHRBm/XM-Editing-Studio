import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='win32') throw Error('The C# + WebView2 desktop build requires Windows x64.');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/build-native-host.ps1')],{cwd:root,windowsHide:true,stdio:'inherit',env});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
