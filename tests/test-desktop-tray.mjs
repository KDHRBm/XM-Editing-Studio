import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDesktopTray } from '../app/electron/desktop-tray.mjs';

test('tray reopens editor, toggles pet and fully quits; menu follows pet visibility', async () => {
  let instance, opened = 0, quit = 0, visible = true, name = '大肥鱼';
  class Tray extends EventEmitter {
    constructor() { super(); instance = this; }
    setToolTip(text) { this.tooltip = text; }
    popUpContextMenu(menu) { this.menu = menu; }
    destroy() { this.destroyed = true; }
  }
  const controller = createDesktopTray({ Tray, Menu: { buildFromTemplate: items => items }, icon: 'icon', openMain: () => opened++, togglePet: () => { visible = !visible; }, isPetVisible: () => visible, getPetName: () => name, quit: () => quit++ });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  instance.emit('double-click'); await tick(); assert.equal(opened, 1);
  instance.emit('right-click'); assert.match(instance.menu[1].label, /隐藏/);
  instance.menu[1].click(); await tick(); instance.emit('right-click'); assert.match(instance.menu[1].label, /显示/);
  name = '小鲸'; instance.emit('right-click'); assert.equal(instance.menu[1].label, '显示小鲸');
  instance.menu[0].click(); instance.menu[3].click(); await tick();
  assert.equal(opened, 2); assert.equal(quit, 1);
  controller.dispose(); controller.dispose(); assert.equal(instance.destroyed, true);
});
