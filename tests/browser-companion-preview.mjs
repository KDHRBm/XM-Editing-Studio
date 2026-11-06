import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';

const { chromium } = await import(process.env.XM_PLAYWRIGHT_MODULE || 'playwright');

test('pet settings preview bubble movement and allow 250% scale', async t => {
  const bundle = await build({ stdin: { contents: `
    import * as React from 'react'; import { createRoot } from 'react-dom/client';
    import { CompanionSettings } from './app/src/CompanionSettings.jsx';
    globalThis.i = React; globalThis.calls = [];
    let state = { visible: true, settings: { scale: 100, bubbleX: 50, bubbleY: 0, bubbleBorderColor: '#FFB6C1', phrases: ['你好'] } };
    let listener;
    globalThis.blackObsidian = {
      onCompanionState: fn => { listener = fn; return () => { listener = null; }; },
      companionAction: async (action, value) => {
        calls.push({ action, value });
        if (action === 'animations') return [];
        if (action === 'preview-bubble') return null;
        if (action === 'update-settings') { state = { ...state, settings: { ...state.settings, ...value } }; listener?.(state); }
        return state;
      }
    };
    createRoot(document.getElementById('root')).render(<CompanionSettings />);
  `, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment' });
  const css = await fs.readFile('app/src/companion-settings.css', 'utf8');
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript;charset=utf-8' : 'text/html;charset=utf-8');
    response.end(request.url === '/app.js' ? bundle.outputFiles[0].text : `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, ...(process.env.XM_CHROME_PATH ? { executablePath: process.env.XM_CHROME_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const x = page.getByRole('slider', { name: '气泡左右位置' });
  const y = page.getByRole('slider', { name: '气泡上下位置' });
  const bubble = page.locator('.bos-pet-video .bos-pet-bubble-sample');
  await x.waitFor();
  const before = await bubble.boundingBox();
  await x.focus(); await x.press('ArrowRight');
  await page.waitForFunction(() => calls.some(call => call.action === 'preview-bubble' && call.value.bubbleX === 55));
  const afterX = await bubble.boundingBox();
  assert.ok(afterX.x > before.x, 'bubble preview should move horizontally while adjusting');
  await y.focus(); await y.press('ArrowRight');
  await page.waitForFunction(() => calls.some(call => call.action === 'preview-bubble' && call.value.bubbleY === 5));
  const afterY = await bubble.boundingBox();
  assert.ok(afterY.y > afterX.y, 'bubble preview should move vertically while adjusting');
  assert.equal(await page.getByRole('slider', { name: '动画大小' }).getAttribute('max'), '250');
  await page.getByRole('slider', { name: '动画大小' }).focus();
  await page.getByRole('slider', { name: '动画大小' }).press('End');
  await page.waitForFunction(() => calls.some(call => call.action === 'update-settings' && call.value.scale === 250));
});
