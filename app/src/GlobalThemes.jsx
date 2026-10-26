import { usePanelCollapsed } from './PanelState.jsx';
const THEME_KEY = 'black-obsidian.appearance.v1';
const LEGACY_KEY = 'black-obsidian.music-settings.v1';
export const THEMES = [
  { id: 'obsidian', label: '曜石信号', note: '荧光绿 · 深色经典' },
  { id: 'ios', label: 'iOS 柔和', note: '天空蓝 · 轻盈圆润' },
  { id: 'aurora', label: '极光玻璃', note: '蓝紫渐变 · 通透层次' },
  { id: 'graphite', label: '石墨极简', note: '黑白灰 · 安静专注' },
  { id: 'ocean', label: '深海蓝', note: '海军蓝 · 青色微光' },
  { id: 'burgundy', label: '暗红绒夜', note: '酒红深底 · 玫瑰暖光' },
  { id: 'midnight', label: '午夜暗蓝', note: '墨蓝深底 · 静谧冷光' },
  { id: 'plum', label: '暮色暗紫', note: '烟紫深底 · 柔和微光' },
  { id: 'pine', label: '松影墨绿', note: '松绿深底 · 低调自然' },
  { id: 'matcha', label: '抹茶花园', note: '奶油白 · 清新草绿' },
  { id: 'sunset', label: '日落蜜桃', note: '暖白底 · 柔和珊瑚' },
];
const validTheme = value => THEMES.some(theme => theme.id === value);
function readTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY));
    if (validTheme(saved?.theme)) return saved.theme;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (validTheme(legacy?.theme)) return legacy.theme;
  } catch { /* Fall back when storage is unavailable or damaged. */ }
  return 'obsidian';
}
let currentTheme = readTheme();
const subscribers = new Set();
const notify = () => subscribers.forEach(callback => callback());
function syncStorage(event) {
  if (event.key !== null && event.key !== THEME_KEY && event.key !== LEGACY_KEY) return;
  const next = readTheme();
  if (next !== currentTheme) { currentTheme = next; notify(); }
}
function subscribe(callback) {
  if (!subscribers.size) window.addEventListener('storage', syncStorage);
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
    if (!subscribers.size) window.removeEventListener('storage', syncStorage);
  };
}
export function useGlobalTheme() {
  const theme = i.useSyncExternalStore(subscribe, () => currentTheme);
  i.useLayoutEffect(() => { document.documentElement.dataset.bosTheme = theme; }, [theme]);
  return theme;
}
function selectTheme(theme) {
  if (!validTheme(theme)) return false;
  currentTheme = theme;
  let saved = true;
  try { localStorage.setItem(THEME_KEY, JSON.stringify({ theme })); } catch { saved = false; }
  notify();
  return saved;
}
export function GlobalThemePicker() {
  const theme = useGlobalTheme();
  const [saveError, setSaveError] = i.useState(false);
  const [collapsed, toggleCollapsed] = usePanelCollapsed('appearance');
  return <section className="bos-appearance" aria-labelledby="bos-appearance-title">
    <div className="bos-appearance-heading">
      <div><span className="bos-appearance-eyebrow">MAKE IT YOURS</span><h2 id="bos-appearance-title">界面与主题</h2><p>选择你的创作氛围，五个页面与左侧导航同步焕新。</p></div>
      <div className="bos-panel-heading-actions"><span className="bos-appearance-badge">{collapsed ? THEMES.find(item => item.id === theme).label : `${THEMES.length} 款全局主题`}</span><button type="button" className="bos-panel-toggle" aria-expanded={!collapsed} aria-controls="bos-theme-body" onClick={toggleCollapsed}>{collapsed ? '展开主题' : '收起主题'} <span aria-hidden="true">{collapsed ? '⌄' : '⌃'}</span></button></div>
    </div>
    <div id="bos-theme-body" hidden={collapsed}>
    <div className="bos-appearance-grid" role="group" aria-label="全局主题">
      {THEMES.map(item => <button type="button" key={item.id} className="bos-appearance-choice" data-theme-preview={item.id} aria-pressed={theme === item.id} onClick={() => setSaveError(!selectTheme(item.id))}>
        <span className="bos-theme-mini" aria-hidden="true"><span className="bos-mini-nav"><b /><b /><b /><b /></span><span className="bos-mini-page"><b /><span><i /><i /></span><em /></span></span>
        <span className="bos-theme-caption"><span><strong>{item.label}</strong><small>{item.note}</small></span><span className="bos-theme-check" aria-hidden="true">{theme === item.id ? '✓' : ''}</span></span>
      </button>)}
    </div>
    <p className="bos-appearance-status" role="status">{saveError ? '主题已应用，但本机存储暂不可用，重启后可能需要重新选择。' : `当前：${THEMES.find(item => item.id === theme).label} · 自动保存，重启后继续使用`}</p>
    </div>
  </section>;
}
