import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { requestJianyingAI, buildJianyingAIRequest } from './jianying-ai.mjs';

const allowed = new Set(['status', 'stop', 'modal', 'scan', 'wizard', 'export', 'extract', 'fonts', 'unhide', 'paths', 'files', 'preview', 'rename', 'settings', 'select_template', 'rename_template', 'delete_template']);
export function createJianyingHost({ appDirectory, dataDirectory, minimize = () => {} }) {
  let child, starting, sequence = 0, connection = null, controller = null, lastState = null;
  const pending = new Map();
  const fail = message => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(message)); } pending.clear(); };
  async function start() {
    if (child) return;
    if (starting) return starting;
    starting = (async () => {
      const build = path.join(appDirectory, 'build', 'jianying');
      const manifest = JSON.parse(await readFile(path.join(build, 'engine.json'), 'utf8'));
      if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('剪映 AI 引擎清单无效。');
      const cache = path.join(dataDirectory, 'engine', manifest.sha256);
      const executable = path.join(cache, 'JianYingEngine.exe');
      await mkdir(cache, { recursive: true });
      const hash = bytes => createHash('sha256').update(bytes).digest('hex');
      let cached; try { cached = await readFile(executable); } catch { /* first use */ }
      if (!cached || hash(cached) !== manifest.sha256) {
        const bytes = await readFile(path.join(build, 'JianYingEngine.exe'));
        if (hash(bytes) !== manifest.sha256) throw new Error('剪映 AI 引擎校验失败，请重新更新软件。');
        const temp = executable + '.tmp'; await writeFile(temp, bytes); await rename(temp, executable);
      }
      const processHandle = spawn(executable, ['--data-dir', path.join(dataDirectory, 'settings')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      child = processHandle;
      processHandle.on('error', () => { if (child === processHandle) child = null; controller?.abort(); fail('剪映 AI 引擎无法启动，请重新打开功能页。'); });
      processHandle.on('exit', () => { if (child === processHandle) child = null; controller?.abort(); connection = null; fail('剪映 AI 引擎已退出，请重试。'); });
      const reader = createInterface({ input: processHandle.stdout });
      reader.on('line', line => {
        let value; try { value = JSON.parse(line); } catch { return; }
        if (value.event === 'minimize') { minimize(); return; }
        if (value.event === 'ai') {
          const captured = connection, signal = controller?.signal;
          void (async () => {
            let result;
            try { if (!captured || !signal || signal.aborted) throw new Error('AI 任务已中断或连接未选择。'); result = { text: await requestJianyingAI(captured, value, signal) }; }
            catch (error) { result = { error: error.message }; }
            if (child === processHandle) await command('ai_result', { token: value.token, ...result }).catch(() => {});
          })();
          return;
        }
        const item = pending.get(value.id); if (!item) return;
        pending.delete(value.id); clearTimeout(item.timer);
        if (value.error) item.reject(new Error(value.error)); else { lastState = value.state; item.resolve(value.state); }
      });
    })();
    try { await starting; } finally { starting = null; }
  }
  async function command(action, args = {}) {
    await start();
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('剪映 AI 引擎响应超时，请稍后重试。')); }, 30000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, action, args }) + '\n', error => { if (error) { clearTimeout(timer); pending.delete(id); reject(error); } });
    });
  }
  return {
    async run(action, args = {}, selectedConnection) {
      if (!allowed.has(action) || !args || typeof args !== 'object' || JSON.stringify(args).length > 500000) throw new Error('无效的剪映 AI 操作。');
      if (action === 'stop') controller?.abort();
      if (action === 'scan' || action === 'preview' && args.ai) {
        buildJianyingAIRequest(selectedConnection, { prompt: 'validate' });
        const state = await command('status');
        if (state.busy || state.recording || state.modal) throw new Error('请先结束当前任务。');
        controller?.abort(); controller = new AbortController();
        connection = { provider: { ...selectedConnection.provider }, model: selectedConnection.model };
      }
      return command(action, args);
    },
    async dispose() {
      controller?.abort(); connection = null;
      if (!child) return;
      const handle = child;
      try { await command('shutdown'); } finally { handle.stdin.end(); }
    },
  };
}
