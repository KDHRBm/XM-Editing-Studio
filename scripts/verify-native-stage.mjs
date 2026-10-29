import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]);
const manifest=JSON.parse((await fs.readFile(process.argv[3]||path.join(root,'native-files.json'),'utf8')).replace(/^\ufeff/,''));
if(manifest.architecture!=='csharp-webview2') throw Error('Not a native package');
const entries=Object.entries(manifest.files);let cursor=0;
await Promise.all(Array.from({length:4},async()=>{
  while(cursor<entries.length){const [relative,expected]=entries[cursor++];const file=path.resolve(root,relative);
    if(!file.toLowerCase().startsWith((root+path.sep).toLowerCase()))throw Error('Invalid package path');
    if(createHash('sha256').update(await fs.readFile(file)).digest('hex')!==expected)throw Error('Package checksum mismatch: '+relative);
  }
}));
console.log(`Verified ${entries.length} native package files.`);
