import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { verifyPeriodHelper } from '../app/scripts/verify-native-helper.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
for (const file of ['app/dist/client/index.html', '.generated/native/helpers/PeriodKeeper.exe', 'app/build/jianying/JianYingEngine.exe', 'app/build/jianying/engine.json', 'app/build/watermark/WatermarkEngine.exe', 'app/build/watermark/engine.json']) await fs.access(file);
await verifyPeriodHelper('.generated/native/helpers/PeriodKeeper.exe', 'app/electron/period-helper-integrity.mjs');
const stage = path.join(root, '.generated', `package-${Date.now()}`);
await fs.mkdir(stage, { recursive: true });
try {
  for (const folder of ['electron', 'server', 'shared', 'dist']) await fs.cp(path.join('app', folder), path.join(stage, folder), { recursive: true });
  // Stage only current native components; never ship stale Python build artifacts.
  for (const file of ['app-icon.ico', 'app-icon.png', 'jianying/JianYingEngine.exe', 'jianying/engine.json', 'watermark/WatermarkEngine.exe', 'watermark/engine.json', 'watermark/watermark.png']) {
    const destination = path.join(stage, 'build', file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join('app/build', file), destination);
  }
  await fs.rm(path.join(stage, 'dist', 'client', 'assets', 'provider-portal-scene.png'), { force: true });
  const metadata = JSON.parse(await fs.readFile('app/package.json', 'utf8'));
  delete metadata.dependencies;
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(metadata, null, 2));
  await fs.copyFile('app/THIRD_PARTY_NOTICES.txt', path.join(stage, 'THIRD_PARTY_NOTICES.txt'));
  const result = await packager({ dir: stage, out: 'artifacts', name: 'XM剪辑台', executableName: '小马剪辑台', platform: 'win32', arch: 'x64', electronVersion: '44.9.2', icon: 'app/assets/app-icon.ico', appVersion: metadata.version, buildVersion: metadata.version, asar: true, overwrite: true, prune: false, extraResource: ['.generated/native/helpers'] });
  for (const directory of result) {
    const locales = path.join(directory, 'locales');
    for (const name of await fs.readdir(locales)) {
      if (name !== 'zh-CN.pak' && name !== 'en-US.pak') await fs.rm(path.join(locales, name), { force: true });
    }
  }
  console.log(result.join('\n'));
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
