const {app,BrowserWindow,session}=require('electron');
app.setPath('userData',process.env.XM_MIGRATION_PROFILE);
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
  try {
    await session.defaultSession.protocol.handle('http',()=>new Response('<!doctype html><title>Migration fixture</title>'));
    await window.loadURL('http://127.0.0.1:37651/');
    await window.webContents.executeJavaScript(`(async()=>{
      localStorage.setItem('migration-fixture','第十三集 — Sr. López, espera...');
      localStorage.setItem('xm-theme','matcha');
      const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      const open=indexedDB.open('xm-batch-analysis',1);open.onupgradeneeded=()=>open.result.createObjectStore('state');
      const db=await request(open);const t=db.transaction('state','readwrite');
      t.objectStore('state').put({tasks:[{id:'13',title:'第13集',script:'Sr. López: Espera... — Sí.',matches:[{id:'local-1'}]}]},'queue');
      await new Promise((r,e)=>{t.oncomplete=r;t.onerror=()=>e(t.error)});db.close();
      const indexed=indexedDB.open('qa-with-index',2);indexed.onupgradeneeded=()=>{const s=indexed.result.createObjectStore('items',{keyPath:'id'});s.createIndex('name','name',{unique:true})};
      const other=await request(indexed);const w=other.transaction('items','readwrite');w.objectStore('items').put({id:7,name:'配乐历史'});
      await new Promise((r,e)=>{w.oncomplete=r;w.onerror=()=>e(w.error)});other.close();
      const empty=await request(indexedDB.open('qa-empty',1));empty.close();
    })()`);
  }catch(error){console.error(error);process.exitCode=1}finally{window.destroy();app.quit()}
});
