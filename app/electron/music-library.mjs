import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, rename, readdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LIBRARY_LIMIT } from '../shared/library-match.mjs';

const extensions = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.webm']);
const mimeTypes = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.webm': 'audio/webm' };
const hash = value => createHash('sha256').update(value).digest('hex');
const normalizedPath = value => process.platform === 'win32' ? value.toLowerCase() : value;
const within = (root, filename) => { const relative = path.relative(root, filename); return relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };

export function createMusicLibrary({ settingsFile, limit = LIBRARY_LIMIT, maxEntries = 50000 }) {
  let roots = [], index = new Map(), queue = Promise.resolve();
  let catalog = { directories: [], tracks: [], scannedAt: null, revision: '', warning: '' };
  const exclusive = task => { const next = queue.then(task, task); queue = next.catch(() => {}); return next; };
  const save = async next => {
    if (!settingsFile) return;
    await mkdir(path.dirname(settingsFile), { recursive: true });
    await writeFile(settingsFile + '.tmp', JSON.stringify({ version: 1, directories: next }, null, 2), 'utf8');
    await rename(settingsFile + '.tmp', settingsFile);
  };
  async function scan() {
    const next = new Map(), directories = [];
    let visited = 0, skipped = 0, truncated = false;
    for (const root of roots) {
      const info = { id: hash(normalizedPath(root)), path: root, count: 0, error: '' };
      directories.push(info);
      if (next.size >= limit || visited > maxEntries) { truncated = true; info.error = '扫描范围已达上限，本文件夹尚未扫描。'; continue; }
      try {
        if (normalizedPath(await realpath(root)) !== normalizedPath(root)) throw new Error('原路径已改变，请重新连接此文件夹。');
        const pending = [{ directory: root, depth: 0 }];
        while (pending.length) {
          const { directory, depth } = pending.shift();
          let entries;
          try { entries = await readdir(directory, { withFileTypes: true }); }
          catch (error) { if (directory === root) throw error; skipped++; continue; }
          entries.sort((a, b) => a.name.localeCompare(b.name));
          for (const entry of entries) {
            if (++visited > maxEntries || next.size >= limit) { truncated = true; break; }
            if (entry.isSymbolicLink()) { skipped++; continue; }
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) { if (depth < 12) pending.push({ directory: filename, depth: depth + 1 }); else { skipped++; truncated = true; } continue; }
            if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
            try {
              const canonical = await realpath(filename);
              if (!within(root, canonical)) { skipped++; continue; }
              const id = hash(normalizedPath(canonical));
              if (next.has(id)) continue;
              const file = await stat(canonical);
              const track = { id, libraryId: info.id, title: path.basename(entry.name, path.extname(entry.name)).slice(0, 240), relativePath: path.relative(root, canonical), size: file.size, modifiedAt: file.mtimeMs };
              next.set(id, { ...track, filename: canonical, root }); info.count++;
            } catch { skipped++; }
          }
          if (truncated && (next.size >= limit || visited > maxEntries)) break;
        }
      } catch (error) { info.error = `无法读取音乐文件夹：${error.code || error.message}`; }
    }
    index = next;
    const tracks = [...next.values()].map(({ filename, root, ...track }) => track);
    catalog = { directories, tracks, scannedAt: Date.now(), revision: hash(JSON.stringify(tracks.map(t => [t.id, t.title, t.size, t.modifiedAt]))), warning: [truncated ? `扫描达到范围限制（最多 ${limit} 首、${maxEntries} 个文件项、13 层目录），请连接更具体的音乐文件夹。` : '', skipped ? `${skipped} 个无法访问的项目或链接已跳过。` : ''].filter(Boolean).join(' ') };
    return catalog;
  }
  async function resolve(id) {
    const track = index.get(id);
    if (!track) throw Object.assign(new Error('音乐已移除或音乐库尚未加载，请刷新音乐库。'), { status: 404 });
    const canonical = await realpath(track.filename).catch(() => { throw Object.assign(new Error('本地音乐文件已移动或删除，请刷新音乐库。'), { status: 404 }); });
    if (!within(track.root, canonical) || normalizedPath(canonical) !== normalizedPath(track.filename)) throw Object.assign(new Error('音乐文件路径已改变，请刷新音乐库。'), { status: 403 });
    const file = await stat(canonical);
    if (!file.isFile() || file.size !== track.size || file.mtimeMs !== track.modifiedAt) throw Object.assign(new Error('音乐文件已更新，请刷新音乐库后重新选择。'), { status: 409 });
    return { ...track, filename: canonical };
  }
  return {
    getCatalog: () => catalog,
    init: () => exclusive(async () => {
      try {
        const saved = JSON.parse(await readFile(settingsFile, 'utf8'));
        if (!Array.isArray(saved.directories) || saved.directories.length > 20 || saved.directories.some(value => typeof value !== 'string' || !path.isAbsolute(value))) throw new Error('音乐库设置格式无效');
        roots = [...new Set(saved.directories)];
      } catch (error) { if (error.code !== 'ENOENT') { catalog = { ...catalog, warning: '无法读取原音乐库设置，请重新连接音乐文件夹。' }; return catalog; } }
      return scan();
    }),
    connect: directory => exclusive(async () => {
      if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('请选择有效的音乐文件夹。');
      const root = await realpath(directory);
      if (!(await stat(root)).isDirectory()) throw new Error('请选择文件夹。');
      const next = roots.some(value => normalizedPath(value) === normalizedPath(root)) ? roots : [...roots, root];
      if (next.length > 20) throw new Error('最多连接 20 个音乐文件夹。');
      await save(next); roots = next; return scan();
    }),
    disconnect: id => exclusive(async () => { const next = roots.filter(root => hash(normalizedPath(root)) !== id); await save(next); roots = next; return scan(); }),
    refresh: () => exclusive(scan),
    resolve,
    async serve(req, res) {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw Object.assign(new Error('不允许跨站访问本地音乐。'), { status: 403 });
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      const id = pathname.slice('/local-music/'.length);
      if (!/^[a-f0-9]{64}$/.test(id)) throw Object.assign(new Error('音乐标识无效。'), { status: 404 });
      const track = await resolve(id);
      const size = track.size; let start = 0, end = size - 1;
      const headers = { 'Content-Type': mimeTypes[path.extname(track.filename).toLowerCase()], 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' };
      if (!size) { res.writeHead(200, { ...headers, 'Content-Length': 0 }); res.end(); return; }
      if (req.headers.range) {
        const range = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
        if (!range || !range[1] && !range[2]) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
        if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1; }
        else start = Math.max(0, size - Number(range[2]));
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      }
      res.writeHead(req.headers.range ? 206 : 200, { ...headers, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(track.filename, { start, end });
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    },
  };
}
