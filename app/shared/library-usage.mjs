export const MUSIC_USAGE_LIMIT = 10;
export const MUSIC_USAGE_KEY = 'xm.library-usage.v1';

export function normalizeMusicUsage(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(item => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || seen.has(item.id)) return false;
    seen.add(item.id); return true;
  }).slice(0, MUSIC_USAGE_LIMIT).map(({ id, title, relativePath, usedAt }) => ({ id, title: title.slice(0, 240), relativePath: typeof relativePath === 'string' ? relativePath.slice(0, 1000) : '', usedAt: Number.isFinite(usedAt) ? usedAt : 0 }));
}

export function rememberMusicUsage(history, track, usedAt = Date.now()) {
  return normalizeMusicUsage([{ id: track.id, title: track.title, relativePath: track.relativePath, usedAt }, ...normalizeMusicUsage(history).filter(item => item.id !== track.id)]);
}

export function excludeUsedMusic(tracks, history) {
  const used = new Set(normalizeMusicUsage(history).map(item => item.id));
  return tracks.filter(track => !used.has(track.id));
}

export function shuffleMusicResults(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function createMusicUsageStore(storage) {
  let history = [], error = '';
  try { history = normalizeMusicUsage(JSON.parse(storage.getItem(MUSIC_USAGE_KEY) || '[]')); }
  catch { error = '最近使用音乐读取失败；本次使用仍会记录，请检查本机存储。'; }
  let state = { history, error };
  const listeners = new Set();
  const update = next => {
    history = next; error = '';
    try { storage.setItem(MUSIC_USAGE_KEY, JSON.stringify(history)); }
    catch { error = '使用记录暂时无法保存，当前窗口仍使用最新记录；重启后可能丢失，请检查本机存储。'; }
    state = { history, error };
    listeners.forEach(listener => listener());
  };
  return {
    snapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    remember(track) {
      update(rememberMusicUsage(state.history, track));
    },
    forget(id) { update(state.history.filter(item => item.id !== id)); },
    toggle(track) {
      const used = state.history.some(item => item.id === track.id);
      update(used ? state.history.filter(item => item.id !== track.id) : rememberMusicUsage(state.history, track));
      return !used;
    },
  };
}
