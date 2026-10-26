import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import electron from 'electron';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (process.platform !== 'win32') throw new Error('Desktop helpers require Windows x64.');
for (const file of ['app/dist/client/index.html', '.generated/native/helpers/PeriodKeeper.exe', 'app/build/jianying/engine.json']) {
  try { await fs.access(file); } catch { throw new Error(`Missing ${file}. Run npm run build and npm run build:native first.`); }
}
await fs.cp('.generated/native/helpers', path.join(path.dirname(electron), 'resources/helpers'), { recursive: true });
const child = spawn(electron, ['app', `--user-data-dir=${path.join(root, '.local-profile')}`], { stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
