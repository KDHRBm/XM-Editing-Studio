import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const stage=path.resolve(process.argv[2]);
const entries=[];
async function walk(folder) {
  for(const entry of await fs.readdir(folder,{withFileTypes:true})) {
    const file=path.join(folder,entry.name);
    if(entry.isSymbolicLink()) throw Error('Package must not contain linked files');
    if(entry.isDirectory()) await walk(file);
    else if(entry.isFile() && file!==path.join(stage,'native-files.json')) entries.push(file);
  }
}
await walk(stage);entries.sort();const files={};let cursor=0;
await Promise.all(Array.from({length:4},async()=>{
  while(cursor<entries.length){const file=entries[cursor++];files[path.relative(stage,file).replaceAll('\\','/')]=createHash('sha256').update(await fs.readFile(file)).digest('hex');}
}));
await fs.writeFile(path.join(stage,'native-files.json'),JSON.stringify({version:'1.4.2',architecture:'csharp-webview2',files},null,2));
console.log(`Native package verified: ${entries.length} files.`);
