import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { companionMarkup } from '../app/electron/companion-dock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex').toLowerCase();
for (const [exe, manifest] of [
  ['app/build/jianying/JianYingEngine.exe', 'app/build/jianying/engine.json'],
  ['app/build/watermark/WatermarkEngine.exe', 'app/build/watermark/engine.json'],
]) {
  if (existsSync(exe)) {
    writeFileSync(manifest, `{\n  "sha256": "${sha256(exe)}"\n}\n`, 'utf8');
  }
}
await fs.rm('app/dist/client/watermarker', { recursive: true, force: true }).catch(() => {});
await fs.mkdir('app/dist/client/assets', { recursive: true });
await build({
  entryPoints: ['app/src/webview2-bridge.ts'],
  bundle: true,
  outfile: 'app/dist/client/assets/webview2-bridge.js',
  format: 'iife',
  target: 'chrome120',
  minify: true,
});
await fs.writeFile('app/public/companion-panel.html', companionMarkup.panelHtml(true), 'utf8');
await fs.cp('app/public', 'app/dist/client', { recursive: true });
await fs.mkdir('app/build/watermark', { recursive: true });
for (const name of ['app-icon.ico', 'app-icon.png']) await fs.copyFile(`app/assets/${name}`, `app/build/${name}`);
await fs.copyFile('app/public/watermark.png', 'app/build/watermark/watermark.png');
await fs.copyFile('app/public/watermark.png', 'app/assets/watermark.png');
await import('../app/scripts/build-upgrade.mjs');
console.log('Renderer and native UI built. Native Windows helpers: npm run build:native');
