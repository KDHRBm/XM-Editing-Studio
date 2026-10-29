// Keep a visible way back to the editor while its companion runs in the background.
export function createDesktopTray({ Tray, Menu, icon, openMain, togglePet, isPetVisible, getPetName = () => '大肥鱼', navigate = () => {}, checkUpdate = () => {}, quit, onError = () => {} }) {
  const tray = new Tray(icon, 'c49efbe7-35d5-4e85-a04c-b0d473efc674');
  let disposed = false;
  const run = action => () => { void Promise.resolve().then(action).catch(onError); };
  const menu = () => Menu.buildFromTemplate([
    { label: '打开 XM剪辑台', click: run(openMain) },
    { label: (isPetVisible() ? '隐藏' : '显示') + getPetName(), click: run(togglePet) },
    { type: 'separator' },
    { label: '批量水印中心（原生硬件加速）', click: run(() => navigate('watermark')) },
    { label: '剪映智能工作台', click: run(() => navigate('jianying')) },
    { label: '文案拆解与智能配乐', click: run(() => navigate('workspace')) },
    { label: '剪贴板句号守护', click: run(() => navigate('period')) },
    { type: 'separator' },
    { label: '检查版本更新', click: run(checkUpdate) },
    { label: '彻底退出 XM剪辑台', click: run(quit) },
  ]);
  tray.setToolTip('XM剪辑台 · 双击打开，右键彻底退出');
  tray.on('click', run(openMain));
  tray.on('double-click', run(openMain));
  tray.on('right-click', () => { if (!disposed) tray.popUpContextMenu(menu()); });
  return { dispose() { if (!disposed) { disposed = true; tray.destroy(); } } };
}
