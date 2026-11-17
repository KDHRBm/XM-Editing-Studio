export function requireMusicCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.tracks) || !Array.isArray(catalog.directories)) throw new Error('音乐库尚未就绪，请等待加载完成或刷新音乐库。');
  if (catalog.loading) throw new Error('音乐库正在扫描，请等待完成后再分析。');
  if (catalog.error || catalog.directories.some(folder => folder.error)) throw new Error('音乐库读取失败，请检查共享目录或磁盘连接后刷新。已保存的目录和推荐会保留。');
  return catalog;
}

export function watchMusicCatalog(api, { onCatalog, onError, onLoading }) {
  let live = true, received = false;
  const stop = api?.onMusicLibraryChanged?.(catalog => {
    if (!live) return;
    received = true; onCatalog(catalog); onLoading(false);
  });
  onLoading(true);
  Promise.resolve().then(() => {
    if (!api?.getMusicLibrary) throw new Error('音乐库接口尚未就绪，请重新打开剪辑台。');
    return api.getMusicLibrary();
  }).then(catalog => { if (live && !received) onCatalog(catalog); })
    .catch(error => { if (live && !received) onError(error.message || '无法读取音乐库，请刷新重试。'); })
    .finally(() => { if (live) onLoading(false); });
  return () => { live = false; stop?.(); };
}
