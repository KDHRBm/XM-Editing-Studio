import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDesktopTray } from '../app/electron/desktop-tray.mjs';

test('tray reopens editor, toggles pet and fully quits; menu follows pet visibility', async () => {
  const destinations = []; let checked = 0;
  let instance, opened = 0, quit = 0, visible = true, name = '大肥鱼';
  class Tray extends EventEmitter {
    constructor() { super(); instance = this; }
    setToolTip(text) { this.tooltip = text; }
    popUpContextMenu(menu) { this.menu = menu; }
    destroy() { this.destroyed = true; }
  }
  const controller = createDesktopTray({ Tray, Menu: { buildFromTemplate: items => items }, icon: 'icon', openMain: () => opened++, togglePet: () => { visible = !visible; }, isPetVisible: () => visible, getPetName: () => name, navigate: target => destinations.push(target), checkUpdate: () => checked++, quit: () => quit++ });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  instance.emit('double-click'); await tick(); assert.equal(opened, 1);
  instance.emit('right-click'); assert.match(instance.menu[1].label, /隐藏/);
  instance.menu[1].click(); await tick(); instance.emit('right-click'); assert.match(instance.menu[1].label, /显示/);
  name = '小鲸'; instance.emit('right-click'); assert.equal(instance.menu[1].label, '显示小鲸');
  instance.menu[0].click(); instance.menu.find(item => item.label?.startsWith('彻底退出')).click(); await tick();
  assert.equal(opened, 2); assert.equal(quit, 1);
  for (const label of ['批量水印中心（原生硬件加速）','剪映智能工作台','文案拆解与智能配乐','剪贴板句号守护','检查版本更新']) instance.menu.find(item => item.label === label).click();
  await tick(); assert.deepEqual(destinations, ['watermark','jianying','workspace','period']); assert.equal(checked, 1);
  controller.dispose(); controller.dispose(); assert.equal(instance.destroyed, true);
});
