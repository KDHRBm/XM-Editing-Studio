// Runs before loading the application so defaults cannot replace imported data.
async function importLegacyState(data) {
  if (data.version !== 1 || !data.localStorage || !Array.isArray(data.databases)) throw new Error('旧版数据快照格式无效');
  const request = value => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
  let records = 0;
  for (const source of data.databases) {
    const opening = indexedDB.open(source.name, source.version);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      for (const table of source.stores) {
        const store = db.objectStoreNames.contains(table.name) ? opening.transaction.objectStore(table.name) : db.createObjectStore(table.name, { keyPath: table.keyPath, autoIncrement: table.autoIncrement });
        for (const index of table.indexes || []) if (!store.indexNames.contains(index.name)) store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
      }
    };
    const db = await request(opening);
    try {
      if (!source.stores.length) continue;
      const transaction = db.transaction(source.stores.map(item => item.name), 'readwrite');
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error('数据写入中断'));
        for (const table of source.stores) {
          const store = transaction.objectStore(table.name);
          for (const row of table.records) { if (store.keyPath === null) store.put(row.value, row.key); else store.put(row.value); records++; }
        }
      });
      for (const table of source.stores) {
        for (const row of table.records) { const actual = await request(db.transaction(table.name).objectStore(table.name).get(row.key)); if (JSON.stringify(actual) !== JSON.stringify(row.value)) throw new Error('分集任务写入校验失败'); }
      }
    } finally { db.close(); }
  }
  for (const [key, value] of Object.entries(data.localStorage)) {
    if (typeof value !== 'string') throw new Error('旧版设置格式无效');
    localStorage.setItem(key, value);
    if (localStorage.getItem(key) !== value) throw new Error('旧版设置写入校验失败');
  }
  return { localStorageKeys: Object.keys(data.localStorage).length, databaseRecords: records };
}
