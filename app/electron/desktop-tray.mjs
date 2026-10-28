// Keep a visible way back to the editor while its companion runs in the background.
export function createDesktopTray({ Tray, Menu, icon, openMain, togglePet, isPetVisible, getPetName = () => '大肥鱼', quit, onError = () => {} }) {
  const tray = new Tray(icon, 'c49efbe7-35d5-4e85-a04c-b0d473efc674');
  let disposed = false;
  const run = action => () => { void Promise.resolve().then(action).catch(onError); };
  const menu = () => Menu.buildFromTemplate([
    { label: '打开 XM剪辑台', click: run(openMain) },
    { label: (isPetVisible() ? '隐藏' : '显示') + getPetName(), click: run(togglePet) },
    { type: 'separator' },
    { label: '彻底退出', click: run(quit) },
  ]);
  tray.setToolTip('XM剪辑台 · 双击打开，右键彻底退出');
  tray.on('double-click', run(openMain));
  tray.on('right-click', () => { if (!disposed) tray.popUpContextMenu(menu()); });
  return { dispose() { if (!disposed) { disposed = true; tray.destroy(); } } };
}
