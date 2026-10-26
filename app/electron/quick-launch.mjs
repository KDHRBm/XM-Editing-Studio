import { readdir, stat, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const execute = promisify(execFile);
const looksLikeJianying = name => /jianying|剪映|bytedance/i.test(name);
export async function discoverJianying(extraPaths = []) {
  const roots = new Set([path.join(os.homedir(), 'JianyingPro'), path.join(os.homedir(), 'AppData', 'Local', 'JianyingPro'), path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'JianyingPro'), ...extraPaths]);
  const found = new Map();
  async function accept(file) {
    if (path.basename(file).toLowerCase() !== 'jianyingpro.exe') return;
    try { const info = await stat(file); if (info.isFile()) found.set(path.resolve(file).toLowerCase(), { path: path.resolve(file), modifiedAt: info.mtimeMs }); } catch { /* stale install entry */ }
  }
  const registryKeys = ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\JianyingPro.exe', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\JianyingPro.exe'];
  await Promise.allSettled(registryKeys.map(async key => {
    const { stdout } = await execute('reg.exe', ['query', key, '/s'], { windowsHide: true, timeout: 8000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' });
    for (const line of stdout.split(/\r?\n/)) {
      const value = line.split(/\s+REG_(?:SZ|EXPAND_SZ)\s+/)[1];
      if (!value || !looksLikeJianying(value)) continue;
      const clean = value.trim().replace(/^"|"(?:,\d+)?$/g, '').replace(/,\d+$/, '');
      if (/jianyingpro\.exe$/i.test(clean)) await accept(clean);
      else if (!/\.exe/i.test(clean) && path.isAbsolute(clean)) roots.add(clean);
    }
  }));
  // Bound discovery: inspect fixed drive roots and common install folders, never crawl media trees.
  const driveRoots = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => letter + ':\\');
  await Promise.allSettled(driveRoots.map(async root => {
    let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) if (entry.isDirectory() && (looksLikeJianying(entry.name) || /^(program files(?: \(x86\))?|programs|apps|software|软件|应用)$/i.test(entry.name))) roots.add(path.join(root, entry.name));
  }));
  let scanned = 0;
  async function scan(folder, depth = 0) {
    if (++scanned > 1200 || depth > 3) return;
    if (/\.exe$/i.test(folder)) { await accept(folder); return; }
    await accept(path.join(folder, 'JianyingPro.exe'));
    let entries; try { entries = await readdir(folder, { withFileTypes: true }); } catch { return; }
    for (const item of entries.slice(0, 200)) {
      if (!item.isDirectory() || item.isSymbolicLink()) continue;
      if (looksLikeJianying(item.name) || /^\d+(?:\.\d+){1,5}$/.test(item.name) || /^(apps|application|programs)$/i.test(item.name)) await scan(path.join(folder, item.name), depth + 1);
    }
  }
  await Promise.allSettled([...roots].map(root => scan(root)));
  return [...found.values()].sort((a, b) => b.path.localeCompare(a.path, undefined, { numeric: true })).map(item => ({ ...item, name: '剪映专业版', version: path.basename(path.dirname(item.path)) }));
}

export function createQuickLaunch({ settingsFile, shell, chooseDirectory, chooseExecutable, discover = discoverJianying }) {
  let settings = { folders: [], selected: '' }, loaded, scanning, installs = [], mutations = Promise.resolve();
  const serialize = operation => (...args) => {
    const result = mutations.then(() => operation(...args));
    mutations = result.catch(() => {});
    return result;
  };
  async function load() {
    if (!loaded) loaded = (async () => { try { const value = JSON.parse(await readFile(settingsFile, 'utf8')); settings = { folders: Array.isArray(value.folders) ? value.folders.filter(item => typeof item?.id === 'string' && typeof item?.path === 'string' && path.isAbsolute(item.path)).slice(0, 8) : [], selected: typeof value.selected === 'string' ? value.selected : '' }; } catch { /* initial settings */ } })();
    await loaded;
  }
  async function save(next) { await mkdir(path.dirname(settingsFile), { recursive: true }); await writeFile(settingsFile + '.tmp', JSON.stringify(next)); await rename(settingsFile + '.tmp', settingsFile); settings = next; }
  const snapshot = () => ({ folders: settings.folders, installs, selected: installs.some(item => item.path === settings.selected) ? settings.selected : installs[0]?.path || '' });
  async function scan() { await load(); if (!scanning) scanning = discover(settings.selected ? [settings.selected] : []).then(value => { installs = value; return snapshot(); }).finally(() => { scanning = null; }); return scanning; }
  return {
    scan,
    addFolder: serialize(async () => { await load(); if (settings.folders.length >= 8) throw new Error('最多设置八个自定义文件夹。'); const folder = await chooseDirectory(); if (folder && !settings.folders.some(item => item.path.toLowerCase() === folder.toLowerCase())) await save({ ...settings, folders: [...settings.folders, { id: randomUUID(), name: path.basename(folder) || folder, path: folder }] }); return snapshot(); }),
    removeFolder: serialize(async id => { await load(); await save({ ...settings, folders: settings.folders.filter(item => item.id !== id) }); return snapshot(); }),
    async openFolder(id) { await load(); const folder = settings.folders.find(item => item.id === id); if (!folder || !(await stat(folder.path).catch(() => null))?.isDirectory()) throw new Error('文件夹不存在或磁盘未连接，请重新选择。'); const error = await shell.openPath(folder.path); if (error) throw new Error(error); },
    select: serialize(async file => { await load(); if (!installs.some(item => item.path === file)) throw new Error('请重新检测剪映启动项。'); await save({ ...settings, selected: file }); return snapshot(); }),
    browse: serialize(async () => { await load(); const file = await chooseExecutable(); if (file) { if (path.basename(file).toLowerCase() !== 'jianyingpro.exe') throw new Error('请选择 JianyingPro.exe。'); await save({ ...settings, selected: file }); } return scan(); }),
    async launch() { await load(); const selected = snapshot().selected; if (!selected || !installs.some(item => item.path === selected) || !(await stat(selected).catch(() => null))?.isFile()) throw new Error('未找到剪映，请重新检测或手动选择启动程序。'); const error = await shell.openPath(selected); if (error) throw new Error(error); },
  };
}
