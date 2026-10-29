import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export function createCompanionRuntime({ directory, dataDirectory, hostArgs = [], onChange = () => {}, onEvent = () => {} }) {
  let child, connection, starting, eventServer, closed = false;
  let cached = { ready: false, visible: false, settings: {}, version: '4.3.4', animationCount: 106 };
  const stateFile = path.join(dataDirectory, 'companion-bridge.json');
  let manifest;
  async function inventory() {
    manifest ||= JSON.parse(await readFile(path.join(directory, 'xm-manifest.json'), 'utf8'));
    cached.version = manifest.version; cached.animationCount = manifest.animations.length;
    return manifest.animations;
  }
  async function command(action, value) {
    if (!connection) throw new Error('请先开启桌宠。');
    const response = await fetch(`http://127.0.0.1:${connection.port}/command`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` },
      body: JSON.stringify({ action, value }), signal: AbortSignal.timeout(15000),
    });
    const state = await response.json();
    if (!response.ok || state.error) throw new Error(state.error || '桌宠操作失败。');
    cached = state; onChange(state); return state;
  }
  async function start() {
    if (closed) throw new Error('软件正在退出。');
    if (connection) return command('status');
    if (starting) return starting;
    if (child) throw new Error('桌宠进程正在退出，请稍后重试。');
    starting = (async () => {
      await inventory(); await mkdir(dataDirectory, { recursive: true });
      await rm(path.join(dataDirectory, 'companion-startup-error.txt'), { force: true });
      const session = randomUUID(), token = randomBytes(32).toString('hex');
      eventServer = createServer((req, res) => {
        const auth = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${token}`);
        if (req.method !== 'POST' || req.url !== '/event' || req.headers.origin || auth.length !== expected.length || !timingSafeEqual(auth, expected)) { res.writeHead(403); res.end(); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 1024) req.destroy(); });
        req.on('end', () => {
          try { if (JSON.parse(body).action !== 'open-panel') throw new Error('unknown event'); res.writeHead(204); res.end(); Promise.resolve(onEvent('open-panel')).catch(() => {}); }
          catch { res.writeHead(400); res.end(); }
        });
      });
      await new Promise((resolve, reject) => { eventServer.once('error', reject); eventServer.listen(0, '127.0.0.1', resolve); });
      const env = { ...process.env, XM_COMPANION_DATA: dataDirectory, XM_COMPANION_TOKEN: token, XM_COMPANION_SESSION: session,
        XM_COMPANION_EVENT_PORT: String(eventServer.address().port), XM_COMPANION_PARENT_PID: String(process.pid), XM_COMPANION_HOST: process.execPath, XM_COMPANION_HOST_ARGS: JSON.stringify(hostArgs) };
      delete env.XM_COMPANION_OWNER_PID;
      delete env.QT_PLUGIN_PATH; delete env.QT_QPA_PLATFORM_PLUGIN_PATH;
      let launchError;
      child = spawn(path.join(directory, 'dsh-pet-standalone-webm-chat.exe'), [], { cwd: directory, windowsHide: true, stdio: 'ignore', env });
      const own = child;
      own.on('error', error => { launchError = error; if (child === own) { child = null; eventServer?.close(); eventServer = null; } });
      own.on('exit', () => { if (child === own) { child = null; connection = null; eventServer?.close(); eventServer = null; cached = { ...cached, ready: false, visible: false }; onChange(cached); } });
      try { for (let attempt = 0; attempt < 200 && !closed; attempt++) {
        if (launchError) throw launchError;
        let data;
        try { data = JSON.parse(await readFile(stateFile, 'utf8')); } catch { /* The native process writes this file when ready. */ }
        if (data?.session === session && data.pid === own.pid && Number.isInteger(data.port) && data.port > 0 && data.port <= 65535) {
          connection = { port: data.port, token }; return await command('status');
        }
        if (own.exitCode !== null) break;
        await wait(150);
      }
      let detail = '';
      try { detail = (await readFile(path.join(dataDirectory, 'companion-startup-error.txt'), 'utf8')).split('\n').filter(Boolean).at(-1); } catch {}
      throw new Error('桌宠启动失败。' + (detail || '请重试，或查看桌宠日志。'));
      } catch (error) {
        connection = null;
        if (own.pid && own.exitCode === null) { own.kill(); await Promise.race([new Promise(resolve => own.once('exit', resolve)), wait(3000)]); }
        if (child === own && own.exitCode === null) throw new Error('桌宠退出尚未完成，请稍后重试。');
        if (child === own) child = null;
        throw error;
      }
    })().finally(() => { starting = null; });
    return starting;
  }
  async function status() {
    if (connection) {
      try { return await command('status'); }
      catch (error) { return { ...cached, error: error.message }; }
    }
    await inventory(); return cached;
  }
  async function run(action, value) { await start(); return command(action, value); }
  async function stop() {
    await starting?.catch(() => {});
    const own = child;
    if (!own) { eventServer?.close(); eventServer = null; return; }
    await command('quit').catch(() => {});
    for (let i = 0; i < 40 && child === own; i++) await wait(200);
    if (child === own) {
      own.kill(); await Promise.race([new Promise(resolve => own.once('exit', resolve)), wait(3000)]);
      if (child === own) throw new Error('桌宠尚未完全退出，请稍后重试。');
    }
    eventServer?.close(); eventServer = null;
  }
  async function dispose() { closed = true; await stop(); }
  function setDirectory(next) {
    if (child || starting) throw new Error('请先停止桌宠再更换组件。');
    directory = next; manifest = null; cached = { ready: false, visible: false, settings: {} };
  }
  return { start, run, status, inventory, dispose, stop, setDirectory, getDirectory: () => directory, isVisible: () => !!cached.visible, isRunning: () => !!child };
}
