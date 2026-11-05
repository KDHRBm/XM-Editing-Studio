// Palette references are based on the visible theme previews in Atelier 1.1.
// The original app does not expose its theme tokens as a public file.
const entries = [
  ['original', '原始', '深色工作室', 'dark', '#141821', '#202735', '#e9bf78', '#f3f1e9'],
  ['paper-studio', '纸感工作室', '暖白纸页 · 墨绿书签', 'light', '#f3eddf', '#fffaf0', '#416c5e', '#302c28'],
  ['ink-wash', '水墨国风', '宣纸留白 · 朱红点睛', 'light', '#ebe9dd', '#f8f6ed', '#a13f36', '#272c2b'],
  ['risograph', '孔版印刷', '暖纸 · 青红叠印', 'light', '#f3e5ca', '#fff4dc', '#b74748', '#343634'],
  ['blueprint', '工程蓝图', '普鲁士蓝 · 精密线框', 'dark', '#101d3c', '#1c315a', '#e0bd68', '#edf4ff'],
  ['art-deco', '装饰艺术', '暖黑漆面 · 香槟金线', 'dark', '#171510', '#292319', '#e1b968', '#f9ecd1'],
  ['cream-cartoon', '奶油卡通', '柔和奶油 · 活泼珊瑚', 'light', '#fff2db', '#fffaf0', '#9d5142', '#493b37'],
  ['natural-light', '写实光影', '暖石色 · 自然光', 'light', '#e9e5dd', '#faf8f2', '#49674f', '#353b37'],
  ['neon-cyber', '霓虹赛博', '深夜蓝 · 电光青', 'dark', '#0a1020', '#111d34', '#36e0de', '#ecf8fb'],
  ['minimal-white', '极简留白', '纸白 · 墨黑', 'light', '#f5f5f2', '#ffffff', '#242424', '#202020'],
  ['action-comic', '热血漫画', '黑白网点 · 醒目红', 'light', '#f3efe5', '#fffdf8', '#bd3333', '#22201e'],
  ['vinyl-music', '黑胶音乐', '唱片黑 · 琥珀金', 'dark', '#191714', '#28251f', '#d5a66b', '#f5eadc'],
  ['watercolor', '水彩笔刷', '水彩蓝绿 · 纸纹白', 'light', '#edf3ed', '#fbfcf7', '#287078', '#31484b'],
  ['ukiyoe', '浮世绘', '靛蓝潮汐 · 木刻暖色', 'light', '#f3e7d4', '#fff5e5', '#326179', '#303940'],
  ['paper-cut', '窗花剪纸', '朱红剪影 · 暖白纸', 'light', '#f9ede1', '#fff8ef', '#b63e37', '#3d2a2a'],
  ['stained-glass', '彩色玻璃', '宝石蓝绿 · 金色边线', 'dark', '#10222d', '#193742', '#d4b15d', '#e9f6f3'],
  ['crt-terminal', 'CRT 终端', '深黑屏幕 · 琥珀字符', 'dark', '#111310', '#1a1e17', '#e0b661', '#f3dfb8'],
  ['pixel-adventure', '像素冒险', '复古深蓝 · 像素黄', 'dark', '#202338', '#30354f', '#efce72', '#f6f2de'],
  ['paper-lantern', '纸雕灯影', '层叠纸影 · 暖灯金', 'light', '#ede4d4', '#fff8e8', '#875929', '#40352c'],
  ['screen-print', '丝印海报', '奶油纸 · 套色青红', 'light', '#f5e9d1', '#fff5e1', '#a13e37', '#344a4a'],
  ['engraving', '铜版画', '压印纸 · 深褐线条', 'light', '#e9e2d3', '#f9f4e8', '#69533e', '#312a25'],
  ['crayon-book', '蜡笔儿童绘本', '蜡笔粉彩 · 纸白', 'light', '#f6eddf', '#fffaf1', '#994a47', '#514641'],
  ['oil-paint', '油画厚涂', '深青画布 · 赭金颜料', 'dark', '#132b2e', '#1d3b3c', '#d8ad67', '#f4eee0'],
  ['single-line', '一笔画', '浅纸色 · 一道深线', 'light', '#f5f2ea', '#fffefa', '#3d777a', '#323c3c'],
  ['whiteboard', '白板讲解', '洁白板面 · 记号蓝', 'light', '#eff2f1', '#ffffff', '#3973a0', '#27313a'],
  ['shadow-puppet', '皮影戏', '暖幕布 · 雕花朱红', 'light', '#f2dfbc', '#fff0cd', '#a64135', '#3e3027'],
  ['halftone-case', '复古半调案卷', '档案纸 · 印章红', 'light', '#eae2d3', '#f9f3e7', '#a9413a', '#37312e'],
  ['woodcut', '木刻版画', '木纹纸 · 墨色刀痕', 'light', '#ebe8d9', '#faf7eb', '#434943', '#282d2b'],
  ['swiss-type', '瑞士动态排版', '严谨留白 · 信号红', 'light', '#f5f5f2', '#ffffff', '#d43232', '#202326'],
  ['spy-title', '60s 间谍片头', '米色胶片 · 橘红剪影', 'light', '#f0e0c9', '#fff2dd', '#b94936', '#3a302e'],
  ['motion-graphics', '象形运动图形', '清爽薄荷 · 几何绿', 'light', '#e7f2e9', '#fafff8', '#327761', '#263d38'],
  ['data-story', '数据叙事', '暖白图表 · 深海蓝', 'light', '#f2eee6', '#fffdf7', '#447b94', '#2b3c47'],
  ['isometric-info', '等距信息图', '柔和薄荷 · 信息青', 'light', '#eaf2ed', '#fafffa', '#2e7165', '#344645'],
  ['tech-stage', '暗色科技发布', '暗色舞台 · 冷紫聚光', 'dark', '#10121d', '#1c2030', '#aa9de3', '#f1f0fa'],
  ['live-pixel', '活体实机录屏', '黑色屏幕 · 像素暖色', 'dark', '#171a20', '#242a31', '#dfad79', '#f4eee7'],
  ['hologram', '科幻全息界面', '深海黑 · 扫描青', 'dark', '#081820', '#102b36', '#70d9df', '#e9fbfb'],
  ['rubber-hose', '1930s 橡皮管卡通', '黑白胶片 · 柔灰', 'light', '#e8e6dd', '#f9f8f1', '#3c4141', '#282b2c'],
  ['cel-animation', '80 年代赛璐璐动画', '手绘夜色 · 霓虹粉', 'dark', '#202036', '#33344f', '#e09aba', '#f9eafa'],
  ['sci-fi-sitcom', '科幻情景喜剧卡通', '轻快深紫 · 太空蓝', 'dark', '#282139', '#3b3051', '#9ac5db', '#f2eef8'],
  ['fifties-cartoon', '50s 扁平卡通', '暖纸色 · 原子橘', 'light', '#f2e5d2', '#fff2df', '#8e4d34', '#3b3430'],
  ['hd-2d', 'HD-2D', '微缩夜景 · 柔和暖光', 'dark', '#142031', '#223349', '#dcb975', '#f4f0e8'],
  ['mini-game', '微游戏快闪', '深紫底色 · 明亮金', 'dark', '#2b2041', '#41305d', '#e4ba69', '#f5ebfa'],
  ['variety-show', '综艺节奏扁平', '糖果色舞台 · 鲜亮珊瑚', 'light', '#ffedce', '#fff8e7', '#a43e4b', '#433543'],
  ['silent-film', '1920s 默片', '银盐黑白 · 旧片暖灰', 'dark', '#24231f', '#34332e', '#c4b58e', '#f5f2e7'],
  ['liminal-horror', '后室 / 新怪谈', '空旷走廊 · 旧录像黄', 'dark', '#272b25', '#373c31', '#cfca86', '#f2f1df'],
  ['building-blocks', '积木玩具', '浅色积木 · 玩具蓝', 'light', '#eef1e7', '#fffdf3', '#426587', '#33414a'],
  ['pop-up-book', '纸片立体书', '温暖纸页 · 森林绿', 'light', '#f2ecdc', '#fff8e9', '#4b6d48', '#383a31'],
  ['miniature', '移轴微缩', '柔和城市 · 雾蓝', 'light', '#e9f0ee', '#f9fcf8', '#3a7481', '#34484d'],
  ['low-poly', '低多边形等距', '几何小岛 · 清新蓝绿', 'light', '#e8f1ed', '#f8fcf8', '#2d746a', '#314846'],
  ['glass-product', '玻璃质感产品', '暗场玻璃 · 冰蓝边缘', 'dark', '#101923', '#1c2b35', '#9ccde6', '#eef8fb'],
];

export const ATELIER_THEMES = entries.map(([id, label, note, mode, bg, surface, accent, text]) => ({
  id: `atelier-${id}`, label, note, mode, bg, surface, accent, text, family: 'atelier',
}));

export const SOLID_THEMES = [
  { id: 'solid-dark', label: '纯色深色', note: '统一深色底', mode: 'dark', bg: '#17191b', surface: '#222528', accent: '#d5d9df', text: '#f0f1f3', family: 'solid' },
  { id: 'solid-light', label: '纯色浅色', note: '统一浅色底', mode: 'light', bg: '#f3f4f5', surface: '#ffffff', accent: '#3a5368', text: '#1d262c', family: 'solid' },
  { id: 'solid-custom', label: '自定义底色', note: '选择自己的底色', mode: 'custom', family: 'solid' },
];

function luminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16) / 255);
  return channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

export function isLightColor(hex) {
  return luminance(hex) >= 0.35;
}

export function paletteVars(theme, customColor = '#44515c') {
  if (!theme || theme.family === 'original') return {};
  const custom = theme.mode === 'custom';
  const bg = custom ? customColor : theme.bg;
  const dark = custom ? !isLightColor(bg) : theme.mode === 'dark';
  const surface = custom ? `color-mix(in srgb, ${bg} 88%, ${dark ? '#ffffff' : '#000000'})` : theme.surface;
  const text = custom ? (dark ? '#f5f6f6' : '#182024') : theme.text;
  const accent = custom ? (dark ? '#f4e0ae' : '#234d5b') : theme.accent;
  const onAccent = luminance(accent) > 0.45 ? '#182024' : '#ffffff';
  return {
    '--ui-bg': bg,
    '--ui-sidebar': `color-mix(in srgb, ${bg} 82%, ${surface})`,
    '--ui-surface': surface,
    '--ui-raised': `color-mix(in srgb, ${surface} 87%, ${accent})`,
    '--ui-input': `color-mix(in srgb, ${bg} 55%, ${surface})`,
    '--ui-border': `color-mix(in srgb, ${text} ${dark ? 23 : 17}%, ${surface})`,
    '--ui-text': text,
    '--ui-muted': `color-mix(in srgb, ${text} 65%, ${surface})`,
    '--ui-accent': accent,
    '--ui-on-accent': onAccent,
    '--ui-soft': `color-mix(in srgb, ${accent} ${dark ? 17 : 12}%, ${surface})`,
    '--ui-danger': dark ? '#ffbbb0' : '#a83832',
    '--ui-danger-bg': dark ? '#3d2927' : '#fff0ed',
    '--ui-success': dark ? '#afe1bd' : '#286b45',
    '--ui-success-bg': dark ? '#213c2c' : '#e9f5ed',
    '--ui-warning': dark ? '#f0d295' : '#85591d',
    '--ui-warning-bg': dark ? '#3b301e' : '#fff4e0',
    '--ui-background': bg,
    '--ui-scheme': dark ? 'dark' : 'light',
    '--ui-radius': theme.id === 'atelier-pixel-adventure' || theme.id === 'atelier-crt-terminal' ? '5px' : '10px',
    '--ui-control': theme.id === 'atelier-pixel-adventure' || theme.id === 'atelier-crt-terminal' ? '4px' : '7px',
    '--ui-shadow': dark ? '0 12px 30px #00000026' : '0 10px 28px #00000012',
  };
}
