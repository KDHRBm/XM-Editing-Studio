import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { HELPER_SHA256 } from './period-helper-integrity.mjs';
import { createPunctuationClipboard } from './period-clipboard.mjs';

export function createPeriodKeeper(resourcesDirectory, { clipboard } = {}) {
  const guard = clipboard ? createPunctuationClipboard({ clipboard }) : null;
  let child = null, starting = null, sequence = 0, checkedAt = 0, allowed = true;
  const pending = new Map();
  const failPending = message => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); } pending.clear(); };
  async function start() {
    if (child) return;
    if (starting) return starting;
    starting = (async () => {
      if (process.platform !== 'win32') throw new Error('剪映标点保留功能需要 Windows。');
      const executable = path.join(resourcesDirectory, 'helpers', 'PeriodKeeper.exe');
      const actual = createHash('sha256').update(await readFile(executable)).digest('hex');
      if (actual !== HELPER_SHA256) throw new Error('标点组件校验失败，请重新安装XM剪辑台。');
      const processHandle = spawn(executable, ['--parent-pid', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      child = processHandle;
      processHandle.on('error', error => { child = null; guard?.dispose(); failPending(`无法启动标点组件：${error.message}`); });
      processHandle.on('exit', () => { if (child === processHandle) child = null; guard?.dispose(); failPending('标点组件已退出，请刷新状态后重试。'); });
      const reader = createInterface({ input: processHandle.stdout });
      reader.on('line', line => {
        let result; try { result = JSON.parse(line); } catch { return; }
        const request = pending.get(result.id);
        if (!request) { if (result.error) failPending(result.error); return; }
        pending.delete(result.id); clearTimeout(request.timer);
        if (result.error) request.reject(new Error(result.error)); else request.resolve(result.state);
      });
    })();
    try { await starting; } finally { starting = null; }
  }
  async function command(value) {
    await start();
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('剪映响应较慢，请稍后刷新状态。')); }, 20000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, command: value }) + '\n', error => { if (error) { pending.delete(id); clearTimeout(timer); reject(error); } });
    });
  }
  async function checkUpstreamStatus() {
    if (Date.now() - checkedAt < 300000) { if (!allowed) throw new Error('原项目当前暂停此功能，请稍后再试。'); return; }
    let data;
    try { const response = await fetch('https://raw.githubusercontent.com/Kirota233/JianYing-Period-Keeper/master/auth.json', { signal: AbortSignal.timeout(3000) }); if (response.ok) data = await response.json(); } catch { /* upstream also permits offline use */ }
    if (!data) {
      try {
        const response = await fetch('https://api.github.com/repos/Kirota233/JianYing-Period-Keeper/contents/auth.json?ref=master', { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'Xiaoma-Period-Keeper' } });
        if (response.ok) { const body = await response.json(); data = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')); }
      } catch { /* keep the upstream offline behavior */ }
    }
    checkedAt = Date.now(); allowed = !['blocked', 'destroy'].includes(data?.status);
    if (!allowed) throw new Error('原项目当前暂停此功能，请稍后再试。');
  }
  return {
    async status() { const state = await command('status'); if (!state.enabled) guard?.configure(false); return { ...state, ...guard?.status() }; },
    async probe() { return { ...await command('probe'), ...guard?.status() }; },
    async setEnabled(enabled, mode = 'compatible') {
      if (typeof enabled !== 'boolean' || !['standard', 'compatible'].includes(mode)) throw new Error('无效的标点开关状态。');
      if (enabled) await checkUpstreamStatus();
      if (!enabled) guard?.configure(false, mode);
      const state = await command(enabled ? 'enable' : 'disable');
      return { ...state, ...guard?.configure(!!state.enabled, mode) };
    },
    copy(text) { if (!guard) throw new Error('剪贴板不可用。'); return guard.copy(text); },
    copyPlain(text) { if (!guard) throw new Error('剪贴板不可用。'); return guard.copyPlain(text); },
    async dispose() {
      guard?.dispose();
      if (!child) return;
      const processHandle = child;
      try { await command('shutdown'); } finally { processHandle.stdin.end(); }
    },
  };
}
