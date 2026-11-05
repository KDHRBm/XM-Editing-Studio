import { ATELIER_THEMES, SOLID_THEMES, paletteVars, isLightColor } from './AtelierThemes.mjs';

const THEME_KEY = 'black-obsidian.appearance.v1';
const LEGACY_KEY = 'black-obsidian.music-settings.v1';
const ORIGINAL_THEMES = [
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
export const THEMES = [...ORIGINAL_THEMES.map(item => ({ ...item, family: 'original' })), ...ATELIER_THEMES, ...SOLID_THEMES];
const validTheme = value => THEMES.some(theme => theme.id === value);
function readAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY));
    if (validTheme(saved?.theme)) return { theme: saved.theme, customColor: /^#[0-9a-f]{6}$/i.test(saved.customColor) ? saved.customColor : '#44515c' };
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (validTheme(legacy?.theme)) return { theme: legacy.theme, customColor: '#44515c' };
  } catch { /* Fall back when storage is unavailable or damaged. */ }
  return { theme: 'graphite', customColor: '#44515c' };
}
let { theme: currentTheme, customColor: currentCustomColor } = readAppearance();
const subscribers = new Set();
const notify = () => subscribers.forEach(callback => callback());
function syncStorage(event) {
  if (event.key !== null && event.key !== THEME_KEY && event.key !== LEGACY_KEY) return;
  const next = readAppearance();
  if (next.theme !== currentTheme || next.customColor !== currentCustomColor) {
    currentTheme = next.theme; currentCustomColor = next.customColor; notify();
  }
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
  const appearance = i.useSyncExternalStore(subscribe, () => `${currentTheme}|${currentCustomColor}`);
  const theme = appearance.split('|')[0];
  i.useLayoutEffect(() => {
    const selected = THEMES.find(item => item.id === theme);
    const root = document.documentElement;
    const variables = paletteVars(selected, currentCustomColor);
    for (const key of appliedVariables) root.style.removeProperty(key);
    appliedVariables = Object.keys(variables);
    for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
    document.documentElement.dataset.bosTheme = theme;
    const light = selected?.mode === 'light' || selected?.mode === 'custom' && isLightColor(currentCustomColor) || ['ios', 'matcha', 'sunset'].includes(theme);
    void globalThis.blackObsidian?.setTitlebarTheme?.(theme, light).catch(() => {});
  }, [appearance]);
  return theme;
}
let appliedVariables = [];
function selectTheme(theme, color = currentCustomColor) {
  if (!validTheme(theme)) return false;
  currentTheme = theme;
  currentCustomColor = color;
  let saved = true;
  try { localStorage.setItem(THEME_KEY, JSON.stringify({ theme, customColor: color })); } catch { saved = false; }
  notify();
  return saved;
}
export function GlobalThemePicker() {
  const theme = useGlobalTheme();
  const [saveError, setSaveError] = i.useState(false);
  const [collapsed, setCollapsed] = i.useState(true);
  const [family, setFamily] = i.useState(() => THEMES.find(item => item.id === currentTheme)?.family || 'original');
  const [search, setSearch] = i.useState('');
  const [customColor, setCustomColor] = i.useState(currentCustomColor);
  const toggleCollapsed = () => setCollapsed(value => !value);
  const selected = THEMES.find(item => item.id === theme) || THEMES[0];
  const visible = THEMES.filter(item => item.family === family && `${item.label} ${item.note}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="bos-appearance" aria-labelledby="bos-appearance-title">
    <div className="bos-appearance-heading">
      <div><h2 id="bos-appearance-title">界面与主题</h2></div>
      <div className="bos-panel-heading-actions"><span className="bos-appearance-badge">{selected.label}</span><button type="button" className="bos-panel-toggle" aria-expanded={!collapsed} aria-controls="bos-theme-body" onClick={toggleCollapsed}>{collapsed ? '展开主题' : '收起主题'} <span aria-hidden="true">{collapsed ? '⌄' : '⌃'}</span></button></div>
    </div>
    <div id="bos-theme-body" hidden={collapsed}>
    <div className="bos-theme-toolbar">
      <div className="bos-theme-families" role="tablist" aria-label="主题分类">
        {[['original', '原有主题'], ['atelier', '风格主题'], ['solid', '纯色外观']].map(([id, label]) => <button type="button" key={id} role="tab" aria-selected={family === id} onClick={() => { setFamily(id); setSearch(''); }}>{label}</button>)}
      </div>
      {family === 'atelier' && <input className="bos-theme-search" type="search" placeholder="搜索主题" aria-label="搜索主题" value={search} onChange={event => setSearch(event.target.value)} />}
    </div>
    <div className="bos-appearance-grid" role="group" aria-label="全局主题">
      {visible.map(item => <button type="button" key={item.id} className="bos-appearance-choice" data-theme-preview={item.id} style={paletteVars(item, customColor)} aria-pressed={theme === item.id} onClick={() => setSaveError(!selectTheme(item.id))}>
        <span className="bos-theme-mini" aria-hidden="true"><span className="bos-mini-nav"><b /><b /><b /><b /></span><span className="bos-mini-page"><b /><span><i /><i /></span><em /></span></span>
        <span className="bos-theme-caption"><span><strong>{item.label}</strong><small>{item.note}</small></span><span className="bos-theme-check" aria-hidden="true">{theme === item.id ? '✓' : ''}</span></span>
      </button>)}
    </div>
    {family === 'solid' && <label className="bos-theme-custom-color">自定义底色 <input type="color" value={customColor} onChange={event => { setCustomColor(event.target.value); setSaveError(!selectTheme('solid-custom', event.target.value)); }} /></label>}
    <p className="bos-appearance-status" role="status">{saveError ? '主题已应用，但本机存储暂不可用，重启后可能需要重新选择。' : `当前：${selected.label} · 自动保存`}</p>
    </div>
  </section>;
}
