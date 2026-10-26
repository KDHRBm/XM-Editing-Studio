import path from 'node:path';
import { stat, realpath, open } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { serveStatic } from '../server/desktop-server.mjs';

const browsers = {
  edge: { name: 'Microsoft Edge', relative: 'Microsoft/Edge/Application/msedge.exe' },
  chrome: { name: 'Google Chrome', relative: 'Google/Chrome/Application/chrome.exe' },
};
const videoTypes = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo' };
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export async function findWatermarkBrowsers({ env = process.env, exists = async file => (await stat(file)).isFile() } = {}) {
  const result = [];
  for (const [id, browser] of Object.entries(browsers)) {
    let executable;
    for (const root of [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean)) {
      const candidate = path.join(root, browser.relative);
      try { if (await exists(candidate)) { executable = candidate; break; } } catch { /* Try the next installation location. */ }
    }
    result.push({ id, name: browser.name, available: !!executable, executable });
  }
  return result;
}

export function launchWatermarkBrowser(executable, url) {
  // A dedicated visible app window in the user's chosen browser; no shell or debug flags.
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [`--app=${url}`], { shell: false, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function settingsFrom(input = {}) {
  return { engine: ['auto', 'webav', 'ffmpeg'].includes(input.engine) ? input.engine : 'auto',
    size: input.size === '720' ? '720' : 'original', crf: ['18', '23', '28'].includes(input.crf) ? input.crf : '23',
    audio: input.audio === 'aac' ? 'aac' : 'auto', hardware: 'prefer-hardware' };
}

async function sourceFile(filename, types) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw fail('请重新选择本地视频或水印文件。');
  const canonical = await realpath(filename), info = await stat(canonical);
  const type = types[path.extname(canonical).toLowerCase()];
  if (!info.isFile() || !info.size || !type) throw fail('选择的素材格式不受支持或文件为空。');
  return { filename: canonical, name: path.basename(canonical), size: info.size, modified: info.mtimeMs, type };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createWatermarkBrowser({ clientDirectory, discover = findWatermarkBrowsers, launch = launchWatermarkBrowser, now = Date.now, ttl = 12 * 60 * 60 * 1000 } = {}) {
  let server, starting, origin, disposed = false;
  const sessions = new Map();
  const expire = () => { for (const [token, value] of sessions) if (now() - value.accessed > ttl) sessions.delete(token); };
  const metadata = ({ name, size, type }, id) => ({ id, name, size, type });
  async function serveFile(req, res, item) {
    if (!item) throw fail('找不到此素材。', 404);
    if (await realpath(item.filename) !== item.filename) throw fail('素材路径已改变，请从软件重新打开。', 409);
    const handle = await open(item.filename, 'r');
    let streaming = false;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== item.size || info.mtimeMs !== item.modified) throw fail('素材已被修改，请从软件重新打开。', 409);
      let start = 0, end = item.size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) throw fail('无效的素材读取范围。', 416);
        start = match[1] ? Number(match[1]) : Math.max(0, item.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= item.size || end < start) throw fail('无效的素材读取范围。', 416);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${item.size}`);
      }
      res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': item.type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      const stream = handle.createReadStream({ start, end }); streaming = true;
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } finally { if (!streaming) await handle.close(); }
  }
  async function handle(req, res) {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') throw fail('拒绝跨站访问本地水印任务。', 403);
    if (!['GET', 'HEAD'].includes(req.method)) throw fail('此接口只允许读取。', 405);
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/session/')) {
      expire();
      const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
      const session = sessions.get(token);
      if (!session) throw fail('任务连接已失效，请回到 XM剪辑台重新打开浏览器。', 401);
      session.accessed = now();
      if (url.pathname === '/session/info') return json(res, 200, { browser: session.browser, files: session.files.map(metadata), watermark: session.watermark ? metadata(session.watermark, 'watermark') : null, settings: session.settings });
      if (url.pathname === '/session/watermark') return serveFile(req, res, session.watermark);
      const match = /^\/session\/file\/(\d+)$/.exec(url.pathname);
      if (match) return serveFile(req, res, session.files[Number(match[1])]);
      throw fail('找不到此任务接口。', 404);
    }
    // This separate server exposes only the watermarker assets, never app APIs or music.
    if (!url.pathname.startsWith('/watermarker/')) throw fail('找不到此页面。', 404);
    req.url = url.pathname.slice('/watermarker'.length);
    await serveStatic(req, res, path.join(clientDirectory, 'watermarker'));
  }
  async function start() {
    if (disposed) throw fail('软件已退出，请重新打开。');
    if (server) return;
    if (!starting) starting = new Promise((resolve, reject) => {
      const next = createServer((req, res) => { handle(req, res).catch(error => { if (!res.headersSent && !res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : '无法读取本地素材，请重新选择后打开。' }); else res.destroy(); }); });
      next.once('error', reject);
      next.listen(0, '127.0.0.1', () => { server = next; origin = `http://127.0.0.1:${next.address().port}`; resolve(); });
    }).finally(() => { starting = null; });
    await starting;
  }
  return {
    async list() { return (await discover()).map(({ executable, ...browser }) => browser); },
    async open(input = {}) {
      if (!Object.hasOwn(browsers, input.browser)) throw fail('请选择 Chrome 或 Edge。');
      if (!Array.isArray(input.files) || input.files.length > 100) throw fail('一次最多传递 100 个视频。');
      const browser = (await discover()).find(item => item.id === input.browser && item.available);
      if (!browser) throw fail(`未找到 ${browsers[input.browser].name}，请先安装或选择另一个浏览器。`);
      const files = await Promise.all(input.files.map(file => sourceFile(file, videoTypes)));
      const watermark = input.watermark ? await sourceFile(input.watermark, imageTypes) : null;
      await start(); expire();
      if (sessions.size >= 8) throw fail('已打开的浏览器任务过多，请重启软件释放旧任务后再试。');
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { files, watermark, settings: settingsFrom(input.settings), browser: browser.name, accessed: now() });
      try { await launch(browser.executable, `${origin}/watermarker/index.html#session=${token}`); }
      catch { sessions.delete(token); throw fail('浏览器启动失败，请确认浏览器可正常运行。'); }
      return { browser: browser.name, count: files.length };
    },
    async dispose() { disposed = true; if (starting) await starting.catch(() => {}); sessions.clear(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = null; } },
  };
}
