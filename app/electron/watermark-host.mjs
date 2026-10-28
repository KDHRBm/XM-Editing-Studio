import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';

const DEFAULT_SETTINGS = {
  mode: 'image', // 'image' (default built-in watermark.png from watermarker) | 'text'
  watermarkText: '内部样片 · 严禁外传',
  watermarkImage: 'builtin',
  position: 'fullscreen', // 'fullscreen' (watermarker default) | 'tile' | 'bottom-right' | 'top-right' | 'top-left' | 'bottom-left' | 'center'
  opacity: 1,
  scale: 0.28,
  size: 'original', // 'original' | '1080p' | '720p' | '480p'
  crf: 23,
  audioMode: 'auto', // 'auto' | 'aac'
  outputDir: '',
  suffix: '样片',
};

export function createWatermarkHost({ appDirectory, dataDirectory, onStateChange = () => {} }) {
  let child = null;
  let starting = null;
  let sequence = 0;
  let running = false;
  let cancelRequested = false;
  let settingsLoaded = false;
  let settings = { ...DEFAULT_SETTINGS };
  let jobs = [];
  const pending = new Map();

  const settingsPath = path.join(dataDirectory, 'settings', 'watermark.json');

  async function loadSettings() {
    if (settingsLoaded) return;
    settingsLoaded = true;
    try {
      const raw = JSON.parse(await readFile(settingsPath, 'utf8'));
      if (raw && typeof raw === 'object') {
        settings = {
          ...DEFAULT_SETTINGS,
          ...raw,
          opacity: Math.max(0.05, Math.min(1, Number(raw.opacity) || DEFAULT_SETTINGS.opacity)),
          scale: Math.max(0.08, Math.min(0.8, Number(raw.scale) || DEFAULT_SETTINGS.scale)),
          crf: Math.max(15, Math.min(35, Number(raw.crf) || DEFAULT_SETTINGS.crf)),
        };
      }
    } catch {
      /* first run */
    }
  }

  async function saveSettings() {
    try {
      await mkdir(path.dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch {
      /* ignore write errors */
    }
  }

  function snapshot() {
    const totalCount = jobs.length;
    const completedCount = jobs.filter(j => j.status === 'done').length;
    const errorCount = jobs.filter(j => j.status === 'error').length;
    const activeJob = jobs.find(j => j.status === 'processing') || null;
    const overallProgress = totalCount === 0
      ? 0
      : Math.round(
          jobs.reduce((acc, job) => {
            if (job.status === 'done') return acc + 100;
            if (job.status === 'processing') return acc + (Number(job.progress) || 0);
            return acc;
          }, 0) / totalCount
        );
    return {
      engine: 'windows-media-foundation-hw',
      running,
      totalCount,
      completedCount,
      errorCount,
      overallProgress,
      activeJobId: activeJob?.id || '',
      activeFileName: activeJob?.fileName || '',
      settings: { ...settings },
      jobs: jobs.map(j => ({ ...j })),
    };
  }

  function emit() {
    const state = snapshot();
    try {
      onStateChange(state);
    } catch {
      /* ignore */
    }
    return state;
  }

  function failAllPending(message) {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error(message));
    }
    pending.clear();
  }

  async function ensureEngine() {
    if (child) return;
    if (starting) return starting;
    starting = (async () => {
      const buildDir = path.join(appDirectory, 'build', 'watermark');
      const manifest = JSON.parse(await readFile(path.join(buildDir, 'engine.json'), 'utf8'));
      if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) {
        throw new Error('原生水印引擎清单无效。');
      }
      const engineRoot = path.join(dataDirectory, 'watermark-engine');
      const cacheDir = path.join(engineRoot, manifest.sha256);
      const executable = path.join(cacheDir, 'WatermarkEngine.exe');
      const verifiedMarker = path.join(cacheDir, '.verified');
      await mkdir(cacheDir, { recursive: true });

      const hash = bytes => createHash('sha256').update(bytes).digest('hex');
      let alreadyVerified = false;
      try {
        const [exeStat, markerHash] = await Promise.all([
          stat(executable),
          readFile(verifiedMarker, 'utf8'),
        ]);
        if (exeStat.isFile() && exeStat.size > 4096 && markerHash.trim() === manifest.sha256) {
          alreadyVerified = hash(await readFile(executable)) === manifest.sha256;
        }
      } catch {
        /* first use */
      }

      if (!alreadyVerified) {
        let cached;
        try { cached = await readFile(executable); } catch { /* first use */ }
        if (!cached || hash(cached) !== manifest.sha256) {
          const bytes = await readFile(path.join(buildDir, 'WatermarkEngine.exe'));
          if (hash(bytes) !== manifest.sha256) {
            throw new Error('原生水印引擎完整性校验失败。');
          }
          const temp = executable + '.tmp';
          await writeFile(temp, bytes);
          await rename(temp, executable);
        }
        await writeFile(verifiedMarker, manifest.sha256, 'utf8').catch(() => {});
      }

      // Ensure the built-in watermark.png (from Kirota233/watermarker) is present next to WatermarkEngine.exe
      const cachedWmPng = path.join(cacheDir, 'watermark.png');
      const bundledPng = await readFile(path.join(buildDir, 'watermark.png'));
      let cachedPng;
      try { cachedPng = await readFile(cachedWmPng); } catch { /* first use */ }
      if (!cachedPng || hash(cachedPng) !== hash(bundledPng)) await writeFile(cachedWmPng, bundledPng);

      const handle = spawn(executable, [], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      child = handle;
      handle.on('error', () => {
        if (child === handle) child = null;
        failAllPending('原生水印引擎启动失败。');
      });
      handle.on('exit', () => {
        if (child === handle) child = null;
        failAllPending('原生水印引擎已退出。');
      });

      const rl = createInterface({ input: handle.stdout });
      rl.on('line', line => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.event === 'progress') {
          const entry = pending.get(msg.id);
          if (entry?.onProgress) {
            entry.onProgress(Number(msg.progress) || 0);
          }
          return;
        }
        const entry = pending.get(msg.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(msg.error));
        } else {
          entry.resolve(msg);
        }
      });
    })();
    try {
      await starting;
    } finally {
      starting = null;
    }
  }

  async function sendRpc(action, payload = {}, onProgress = null, timeoutMs = 600000) {
    await ensureEngine();
    const id = ++sequence;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('视频水印处理超时。'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, onProgress });
      child.stdin.write(JSON.stringify({ id, action, ...payload }) + '\n', err => {
        if (!err) return;
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error('无法向原生水印引擎发送指令。'));
      });
    });
  }

  function resolveOutputPath(inputPath) {
    const parsed = path.parse(inputPath);
    const targetDir = settings.outputDir && settings.outputDir.trim()
      ? settings.outputDir.trim()
      : parsed.dir;
    const suffix = (settings.suffix || '样片').trim() || '样片';
    return path.join(targetDir, `${parsed.name}${suffix}.mp4`);
  }

  async function availableOutputPath(inputPath, currentJobId) {
    const proposed = resolveOutputPath(inputPath);
    const parsed = path.parse(proposed);
    for (let index = 0; index < 1000; index++) {
      const candidate = index ? path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`) : proposed;
      if (path.resolve(candidate).toLowerCase() === path.resolve(inputPath).toLowerCase()) continue;
      if (jobs.some(job => job.id !== currentJobId && job.status === 'processing' && job.outputPath.toLowerCase() === candidate.toLowerCase())) continue;
      try { await access(candidate); } catch { return candidate; }
    }
    throw new Error('输出目录中同名文件过多，请更换文件名后缀。');
  }

  async function addVideos(filePaths = []) {
    await loadSettings();
    const validPaths = Array.isArray(filePaths)
      ? filePaths.map(p => String(p || '').trim()).filter(Boolean)
      : [];
    for (const filePath of validPaths) {
      if (jobs.some(j => j.inputPath === filePath && (j.status === 'pending' || j.status === 'processing'))) {
        continue;
      }
      if (!path.isAbsolute(filePath) || !/\.(mp4|mov|mkv|avi|m4v|webm)$/i.test(filePath)) throw new Error('请选择受支持的本地视频文件。');
      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile() || !fileInfo.size) throw new Error('视频文件为空或无法读取。');
      const sizeBytes = fileInfo.size;
      jobs.push({
        id: `wm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        inputPath: filePath,
        fileName: path.basename(filePath),
        sizeBytes,
        outputPath: resolveOutputPath(filePath),
        status: 'pending', // 'pending' | 'processing' | 'done' | 'error' | 'cancelled'
        progress: 0,
        elapsedMs: 0,
        error: '',
      });
    }
    return emit();
  }

  async function updateSettings(patch = {}) {
    await loadSettings();
    if (patch && typeof patch === 'object') {
      settings = {
        ...settings,
        ...patch,
        opacity: patch.opacity !== undefined
          ? Math.max(0.05, Math.min(1, Number(patch.opacity) || settings.opacity))
          : settings.opacity,
        scale: patch.scale !== undefined
          ? Math.max(0.08, Math.min(0.8, Number(patch.scale) || settings.scale))
          : settings.scale,
        crf: patch.crf !== undefined
          ? Math.max(15, Math.min(35, Number(patch.crf) || settings.crf))
          : settings.crf,
      };
      for (const job of jobs) {
        if (job.status === 'pending') {
          job.outputPath = resolveOutputPath(job.inputPath);
        }
      }
      await saveSettings();
    }
    return emit();
  }

  async function removeJob(jobId) {
    jobs = jobs.filter(j => j.id !== jobId || j.status === 'processing');
    return emit();
  }

  async function clearJobs(mode = 'completed') {
    if (mode === 'all') {
      jobs = jobs.filter(j => j.status === 'processing');
    } else {
      jobs = jobs.filter(j => j.status === 'pending' || j.status === 'processing');
    }
    return emit();
  }

  async function retryFailed() {
    for (const job of jobs) {
      if (job.status === 'error' || job.status === 'cancelled') {
        job.status = 'pending';
        job.progress = 0;
        job.error = '';
        job.outputPath = resolveOutputPath(job.inputPath);
      }
    }
    return emit();
  }

  async function startBatch() {
    await loadSettings();
    if (running) return emit();
    const pendingJobs = jobs.filter(j => j.status === 'pending' || j.status === 'error' || j.status === 'cancelled');
    if (pendingJobs.length === 0) return emit();

    for (const job of pendingJobs) {
      job.status = 'pending';
      job.progress = 0;
      job.error = '';
      job.outputPath = resolveOutputPath(job.inputPath);
    }

    running = true;
    cancelRequested = false;
    emit();

    void (async () => {
      try {
        for (const job of jobs) {
          if (cancelRequested) {
            if (job.status === 'pending') job.status = 'cancelled';
            continue;
          }
          if (job.status !== 'pending') continue;

          job.status = 'processing';
          job.progress = 1;
          job.error = '';
          try {
            job.outputPath = await availableOutputPath(job.inputPath, job.id);
            emit();
            const resolvedWmImage = settings.mode === 'image'
              ? (settings.watermarkImage || 'builtin')
              : '';
            const res = await sendRpc(
              'process',
              {
                input: job.inputPath,
                output: job.outputPath,
                watermarkImage: resolvedWmImage,
                watermarkText: settings.watermarkText || '内部样片 · 严禁外传',
                position: settings.position || 'fullscreen',
                opacity: settings.opacity,
                scale: settings.scale,
                size: settings.size || 'original',
                crf: settings.crf || 23,
                audioMode: settings.audioMode || 'auto',
              },
              pct => {
                job.progress = Math.max(1, Math.min(99, pct));
                emit();
              }
            );
            job.status = 'done';
            job.progress = 100;
            job.elapsedMs = Number(res.elapsedMs) || 0;
          } catch (err) {
            if (cancelRequested || /取消/.test(err.message)) {
              job.status = 'cancelled';
              job.error = '已取消';
            } else {
              job.status = 'error';
              job.error = err.message || '水印合成失败';
            }
          }
          emit();
        }
      } finally {
        running = false;
        cancelRequested = false;
        emit();
      }
    })();

    return emit();
  }

  async function cancelBatch() {
    if (!running) return emit();
    cancelRequested = true;
    if (child) {
      try {
        await sendRpc('cancel', {}, null, 3000);
      } catch {
        /* ignore */
      }
    }
    return emit();
  }

  async function getState() {
    await loadSettings();
    return snapshot();
  }

  async function dispose() {
    cancelRequested = true;
    if (!child) return;
    const handle = child;
    const exitPromise = new Promise(resolve => {
      handle.once('exit', resolve);
      setTimeout(resolve, 1500);
    });
    try {
      await sendRpc('shutdown', {}, null, 1200);
    } catch {
      /* ignore */
    }
    try { handle.kill(); } catch { /* ignore */ }
    await exitPromise;
    child = null;
  }

  return {
    getState,
    addVideos,
    updateSettings,
    removeJob,
    clearJobs,
    retryFailed,
    startBatch,
    cancelBatch,
    dispose,
  };
}
