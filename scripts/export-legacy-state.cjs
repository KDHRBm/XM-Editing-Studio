// One-time migration tool. Runs only in a copied, isolated Electron profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const profile = process.env.XM_MIGRATION_PROFILE;
const output = process.env.XM_MIGRATION_OUTPUT;
if (!profile || !output || !path.isAbsolute(profile) || !path.isAbsolute(output)) throw Error('Explicit migration paths required');
app.setPath('userData', profile);
app.whenReady().then(async () => {
  let window;
  try {
    // Intercept the old origin in memory; no server or renderer application starts.
    await require('electron').session.defaultSession.protocol.handle('http', request => {
      if (new URL(request.url).origin !== 'http://127.0.0.1:37651') return new Response('', { status: 403 });
      return new Response('<!doctype html><title>Local migration</title>', { headers: { 'Content-Type': 'text/html' } });
    });
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await window.loadURL('http://127.0.0.1:37651/');
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const request=value=>new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error)});
      const databases=[];
      for(const info of await indexedDB.databases()) {
        if(!info.name) continue;
        const db=await request(indexedDB.open(info.name));
        const source={name:db.name,version:db.version,stores:[]};
        try {
          for(const name of db.objectStoreNames) {
            const transaction=db.transaction(name,'readonly'),store=transaction.objectStore(name);
            const table={name,keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexes:[...store.indexNames].map(key=>{const x=store.index(key);return {name:x.name,keyPath:x.keyPath,unique:x.unique,multiEntry:x.multiEntry}}),records:[]};
            const keys=store.getAllKeys(),values=store.getAll();
            const [k,v]=await Promise.all([request(keys),request(values)]);
            table.records=k.map((key,i)=>({key,value:v[i]}));source.stores.push(table);
          }
        }finally{db.close()}
        databases.push(source);
      }
      return {version:1,sourceOrigin:location.origin,localStorage:Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])),databases};
    })()`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output + '.tmp', JSON.stringify(result), { mode: 0o600 });
    fs.renameSync(output + '.tmp', output);
    // Never print user scripts, keys, conversation data or cookie values.
    console.log(JSON.stringify({ ok: true, keys: Object.keys(result.localStorage).length, databases: result.databases.length, records: result.databases.reduce((n, db) => n + db.stores.reduce((m, store) => m + store.records.length, 0), 0) }));
  } catch (error) { console.error('Migration export failed: ' + error.message); process.exitCode = 1; }
  finally { window?.destroy(); app.quit(); }
});
