import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
await fs.mkdir('app/dist/client/assets', { recursive: true });
await fs.cp('app/public', 'app/dist/client', { recursive: true });
const animationSource = 'app/companion-videos';
const animationTarget = 'app/dist/client/companion-animations';
await fs.cp(animationSource, animationTarget, { recursive: true });
async function animationList(directory, prefix = '') {
  const items = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) items.push(...await animationList(path.join(directory, entry.name), relative));
    else if (entry.isFile() && entry.name.endsWith('.webm')) items.push({ id: relative, name: path.basename(entry.name, '.webm'), category: prefix.split('/')[0] || 'idle' });
  }
  return items;
}
const animations = await animationList(animationSource);
if (!animations.some(item => item.category === 'idle')) throw new Error('Missing companion idle animation.');
await fs.writeFile(path.join(animationTarget, 'manifest.json'), JSON.stringify(animations));
await fs.copyFile('watermarker/public/watermark.png', 'app/dist/client/watermark.png');
await fs.mkdir('app/build', { recursive: true });
for (const name of ['app-icon.ico', 'app-icon.png']) await fs.copyFile(`app/assets/${name}`, `app/build/${name}`);
await import('../app/scripts/build-upgrade.mjs');
await fs.mkdir('watermarker/public/ffmpeg', { recursive: true });
await fs.mkdir('watermarker/public/ffmpeg-worker', { recursive: true });
for (const name of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) await fs.copyFile(`node_modules/@ffmpeg/core/dist/esm/${name}`, `watermarker/public/ffmpeg/${name}`);
for (const name of ['worker.js', 'const.js', 'errors.js']) await fs.copyFile(`node_modules/@ffmpeg/ffmpeg/dist/esm/${name}`, `watermarker/public/ffmpeg-worker/${name}`);
await build({ root: path.join(root, 'watermarker'), configFile: false, base: '/watermarker/', worker: { format: 'es' }, build: { outDir: path.join(root, 'app/dist/client/watermarker'), emptyOutDir: true, chunkSizeWarningLimit: 1500 } });
console.log('Renderer and watermarker built. Native Windows helpers: npm run build:native');
