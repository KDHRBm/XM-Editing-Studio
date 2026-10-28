import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { requestJianyingAI, buildJianyingAIRequest } from './jianying-ai.mjs';
import { isDeepSeekScan } from '../shared/jianying-models.mjs';

const allowed = new Set(['status', 'stop', 'modal', 'scan', 'wizard', 'export', 'extract', 'fonts', 'unhide', 'paths', 'files', 'preview', 'rename', 'settings', 'select_template', 'rename_template', 'delete_template']);
export function createJianyingHost({ appDirectory, dataDirectory, minimize = () => {}, onScanProgress = () => {}, onExportProgress = () => {}, onRecordingProgress = () => {}, beforeScanCapture = async () => {}, spawnProcess = spawn, requestAI = requestJianyingAI, webScan }) {
  let child, starting, sequence = 0, connection = null, controller = null, lastState = null;
  let scan = null, exportTask = null, recording = null, closing = false;
  const scanStages = new Set(['preparing', 'locating', 'analyzing', 'organizing', 'complete', 'error', 'cancelled']);
  const terminal = value => value && ['complete', 'error', 'cancelled'].includes(value.stage);
  const progress = value => {
    if (closing || !scanStages.has(value.stage) || typeof value.id !== 'string' || typeof value.message !== 'string') return;
    if (value.stage !== 'preparing' && (scan?.id !== value.id || terminal(scan))) return;
    scan = { id: value.id, stage: value.stage, message: value.message.slice(0, 600), ...(Number.isInteger(value.count) ? { count: value.count } : {}) };
    if (['cancelled', 'error'].includes(scan.stage)) controller?.abort();
    if (terminal(scan)) webScan?.close();
    onScanProgress(scan);
  };
  const exportProgress = value => {
    if (closing || !['preparing', 'running', 'stopping', 'complete', 'error', 'cancelled'].includes(value.stage) || typeof value.id !== 'string' || typeof value.message !== 'string') return;
    if (value.stage !== 'preparing' && (exportTask?.id !== value.id || terminal(exportTask))) return;
    if (!Number.isInteger(value.total) || value.total < 1 || value.total > 200 || !Number.isInteger(value.completed) || value.completed < 0 || value.completed > value.total || !Number.isInteger(value.current) || value.current < 0 || value.current > value.total || !['return_home', 'wait_close'].includes(value.mode)) return;
    const avoid = Array.isArray(value.avoid) ? value.avoid.slice(0, 210).filter(point => Array.isArray(point) && point.length === 2 && point.every(n => Number.isFinite(n) && n >= 0 && n <= 100000)) : [];
    exportTask = { id: value.id, operation: 'export', stage: value.stage, message: value.message.slice(0, 600), total: value.total, completed: value.completed, current: value.current, mode: value.mode, draftName: String(value.draftName || '').slice(0, 200), avoid };
    onExportProgress(exportTask);
  };
  const recordingProgress = value => {
    if (closing || !['preparing', 'recording', 'retry', 'complete', 'error', 'cancelled'].includes(value.stage) || typeof value.id !== 'string' || typeof value.message !== 'string') return;
    if (value.stage !== 'preparing' && (recording?.id !== value.id || terminal(recording))) return;
    if (!['return_home', 'wait_close'].includes(value.mode) || value.total !== (value.mode === 'wait_close' ? 4 : 3) || !Number.isInteger(value.current) || value.current < 1 || value.current > value.total || !Number.isInteger(value.completed) || value.completed < 0 || value.completed > value.total) return;
    recording = { id: value.id, operation: 'recording', stage: value.stage, message: value.message.slice(0, 600), mode: value.mode, total: value.total, current: value.current, completed: value.completed, step: String(value.step || '').slice(0, 30), skipAvailable: value.skipAvailable === true };
    onRecordingProgress(recording);
  };
  const scanFailed = message => {
    if (scan && !terminal(scan)) progress({ ...scan, stage: 'error', message });
    if (exportTask && !terminal(exportTask)) exportProgress({ ...exportTask, stage: 'error', message: '导出引擎已停止，请返回工作台查看。' });
    if (recording && !terminal(recording)) recordingProgress({ ...recording, stage: 'error', message: '录制引擎已停止，请返回工作台重新录制。' });
  };
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
      const processHandle = spawnProcess(executable, ['--data-dir', path.join(dataDirectory, 'settings')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      child = processHandle;
      processHandle.on('error', () => { if (child !== processHandle) return; child = null; controller?.abort(); scanFailed('扫描引擎无法启动，请返回工作台重试。'); fail('剪映 AI 引擎无法启动，请重新打开功能页。'); });
      processHandle.on('exit', () => { if (child !== processHandle) return; child = null; controller?.abort(); connection = null; scanFailed('扫描引擎已退出，请返回工作台重试。'); fail('剪映 AI 引擎已退出，请重试。'); });
      const reader = createInterface({ input: processHandle.stdout });
      reader.on('line', line => {
        let value; try { value = JSON.parse(line); } catch { return; }
        if (child !== processHandle) return;
        if (value.event === 'minimize') { minimize(); return; }
        if (value.event === 'scan-progress') { progress(value); return; }
        if (value.event === 'export-progress') { exportProgress(value); return; }
        if (value.event === 'recording-progress') { recordingProgress(value); return; }
        if (value.event === 'recording-capture' && value.id === recording?.id && !terminal(recording) && typeof value.token === 'string' && value.token.length <= 64) {
          void (async () => {
            let error = '';
            try { await beforeScanCapture(value.id); } catch { error = '进度卡未能隐藏，请重按 F8。'; }
            if (child === processHandle && !closing) await command('recording_capture_ready', { id: value.id, token: value.token, error }).catch(() => {});
          })();
          return;
        }
        if (value.event === 'scan-capture' && value.id === scan?.id && !terminal(scan)) {
          void (async () => {
            let error = '';
            try { await beforeScanCapture(value.id); } catch { error = '进度卡未能隐藏，请重新扫描。'; }
            if (child === processHandle && !closing) await command('scan_capture_ready', { id: value.id, error }).catch(() => {});
          })();
          return;
        }
        if (value.event === 'ai') {
          const captured = connection, signal = controller?.signal;
          void (async () => {
            let result;
            try {
              if (!captured || !signal || signal.aborted) throw new Error('AI 任务已中断或连接未选择。');
              const scanId = scan?.id;
              const report = message => { if (!signal.aborted && scan && scan.id === scanId && !terminal(scan)) progress({ ...scan, message }); };
              result = { text: isDeepSeekScan(captured) ? await webScan.request(value, signal, report) : await requestAI(captured, value, signal, undefined, { onRetry: report }) };
            }
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
    lastConnection: () => connection,
    async run(action, args = {}, selectedConnection) {
      if (!allowed.has(action) || !args || typeof args !== 'object' || JSON.stringify(args).length > 500000) throw new Error('无效的剪映 AI 操作。');
      if (action === 'stop') { controller?.abort(); webScan?.close(); }
      if (action === 'scan' || action === 'preview' && args.ai) {
        const web = isDeepSeekScan(selectedConnection);
        if (web && (action !== 'scan' || !webScan)) throw new Error('DeepSeek 网页连接仅用于草稿扫描。');
        if (!web) buildJianyingAIRequest(selectedConnection, { prompt: 'validate' });
        const state = await command('status');
        if (state.busy || state.recording || state.modal) throw new Error('请先结束当前任务。');
        controller?.abort(); controller = new AbortController();
        connection = { provider: { ...selectedConnection.provider }, model: selectedConnection.model };
        if (action === 'scan') args = { ...args, webScan: web };
      }
      return command(action, args);
    },
    async dispose() {
      closing = true;
      webScan?.dispose();
      controller?.abort(); connection = null;
      if (!child) return;
      const handle = child;
      try { await command('shutdown'); } finally { handle.stdin.end(); }
    },
  };
}
