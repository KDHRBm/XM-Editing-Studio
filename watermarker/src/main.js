import { createProcessingRun } from './processing-run.mjs';
import { createWatermarkProcessors } from './processing-engines.mjs';
import { desktopBridge, loadBrowserSession } from './browser-session.mjs';
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { Combinator, MP4Clip, ImgClip, OffscreenSprite } from "@webav/av-cliper";
import "./style.css";

const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
  "video/x-msvideo",
]);
const defaultWatermarkUrl = "/watermarker/watermark.png";
let watermarkUrl = defaultWatermarkUrl;
let busy = false;
let activeRun = null;
let processingPromise = null;
let watermarkFile = null;
let externalSession = null;
let launchingBrowser = false;
const bridge = desktopBridge();

// The bundled offline WASM core is single-threaded; WebAV uses system codecs.
const canUseMT = false;
const app = document.querySelector("#app");
app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <h1>批量生成带水印的样片</h1>
    </section>
    <section class="panel">
      <div class="browser-tools" id="browser-tools" hidden>
        <strong>使用浏览器加速</strong>
        <div class="browser-actions"><button id="open-edge" type="button" disabled>交给 Edge 处理</button><button id="open-chrome" type="button" disabled>交给 Chrome 处理</button></div>
        <p id="browser-status" role="status">检测已安装的浏览器…</p>
        <small>自动带入已选视频、水印和画质设置；当前处理会先中断。仅本机读取，请保持 XM剪辑台运行。</small>
      </div>
      <div class="browser-session-info" id="browser-session-info" role="status" hidden></div>
      <label class="drop-zone" id="drop-zone" for="video-input">
        <input id="video-input" type="file" accept="video/*" multiple />
        <span class="drop-icon">＋</span>
        <strong>拖放视频到这里</strong>
        <span>或点击选择视频，可一次处理多个文件</span>
      </label>

      <div class="watermark-picker"><label>水印图片 <input id="watermark-input" type="file" accept="image/png,image/jpeg,image/webp" /></label><button id="watermark-reset" class="text-button" type="button">恢复默认水印</button><img id="watermark-preview" src="/watermarker/watermark.png" alt="当前水印预览" /></div>
      <!-- Settings Bar -->
      <div class="settings-bar" id="engine-bar">
        <label class="select-tag">
          <span style="background: #3a2818; color: #f0b475; border-color: #805828;">处理引擎</span>
          <select id="setting-engine" style="color: #f0b475;">
            <option value="auto" selected>自动加速（推荐）</option>
            <option value="webav">WebAV 加速</option>
            <option value="ffmpeg">FFmpeg WASM（兼容模式）</option>
          </select>
        </label>
        <label class="select-tag">
          <span>画质级别</span>
          <select id="setting-crf">
            <option value="18">高 (大体积)</option>
            <option value="23" selected>中 (均衡/推荐)</option>
            <option value="28">低 (极速小体积)</option>
          </select>
        </label>
        <label class="select-tag"><span>样片尺寸</span><select id="setting-size"><option value="original">原尺寸</option><option value="720">720p 快速样片</option></select></label>
        <div id="engine-hint" style="flex-basis: 100%; font-size: 11.5px; color: #827c73; margin-top: -4px;"></div>
      </div>

      <div class="settings-bar" id="ffmpeg-settings-bar">
        <label class="select-tag">
          <span>加速模式</span>
          <select id="setting-threads" ${!canUseMT ? 'disabled' : ''}>
            ${canUseMT ? `<option value="auto">自动多核 (推荐)</option>` : `<option value="1">单线程 (环境受限)</option>`}
            ${canUseMT ? `
              <option value="1">单线程</option>
              <option value="2">2 线程</option>
              <option value="4">4 线程</option>
              <option value="8">8 线程</option>
            ` : ''}
          </select>
        </label>
        <label class="select-tag">
          <span>音频模式</span>
          <select id="setting-audio">
            <option value="auto">智能直拷 (推荐)</option>
            <option value="aac">强制转码 (AAC)</option>
          </select>
        </label>
      </div>

      <div class="file-area">
        <div class="section-heading">
          <span>待处理视频</span>
          <button id="clear-button" class="text-button" type="button">清空</button>
        </div>
        <ul id="file-list" class="file-list">
          <li class="empty">还没有选择视频</li>
        </ul>
      </div>
      <div class="action-row">
        <button id="start-button" class="primary-button" type="button" disabled>开始处理</button>
        <button id="stop-button" class="stop-button" type="button" hidden>中断处理</button>
        <div class="status-wrap">
          <div class="status" id="status">等待选择视频</div>
          <div class="progress"><div id="progress-bar"></div></div>
        </div>
      </div>

      <section class="processed-tasks" aria-label="已处理任务">
        <div class="processed-heading"><strong>已处理任务 <span id="processed-count">0</span></strong><div><button id="clear-processed" class="text-button" type="button" disabled>清除任务</button><button id="toggle-processed" class="text-button" type="button" aria-controls="processed-body" aria-expanded="true">收起 ⌃</button></div></div>
        <div id="processed-body"><p id="processed-empty">还没有完成的样片</p><div id="output-list" class="output-list" aria-label="已完成样片"></div><small>保留本次打开页面后的完成记录。清除列表不删除已下载的视频；关闭页面前请下载需要的样片。</small></div>
      </section>
      <!-- 报错日志与原因诊断卡片 -->
      <div id="error-card" class="error-card" style="display: none;">
        <div class="error-header">
          <span class="error-title">⚠️ 处理遇到错误</span>
          <button id="close-error" class="text-button" type="button">关闭提示</button>
        </div>
        <p id="error-summary" class="error-summary"></p>
        <details class="error-details" open>
          <summary>查看详细日志与报错原因</summary>
          <pre id="error-log-content" class="error-log-content"></pre>
        </details>
      </div>
    </section>

    <footer class="footer" style="text-align: center; margin-top: 24px; color: #827c73; font-size: 13px;">
      <p>🔒 本地处理，不上传云端</p>
    </footer>
  </main>
`;


const files = [];
const ffmpegLogs = [];
const input = document.querySelector("#video-input");
const dropZone = document.querySelector("#drop-zone");
const fileList = document.querySelector("#file-list");
const clearButton = document.querySelector("#clear-button");
const startButton = document.querySelector("#start-button");
const stopButton = document.querySelector("#stop-button");
const status = document.querySelector("#status");
const progressBar = document.querySelector("#progress-bar");
const errorCard = document.querySelector("#error-card");
const errorSummary = document.querySelector("#error-summary");
const errorLogContent = document.querySelector("#error-log-content");
const closeErrorBtn = document.querySelector("#close-error");

// Settings selectors
const settingEngine = document.querySelector("#setting-engine");
const ffmpegSettingsBar = document.querySelector("#ffmpeg-settings-bar");
const settingThreads = document.querySelector("#setting-threads");
const settingSize = document.querySelector("#setting-size");
const settingCrf = document.querySelector("#setting-crf");
const settingAudio = document.querySelector("#setting-audio");
const engineHint = document.querySelector("#engine-hint");

function updateEngineHint() {
  ffmpegSettingsBar.style.display = settingEngine.value === 'webav' ? 'none' : 'flex';
  engineHint.textContent = settingEngine.value === 'auto' ? 'MP4 优先尝试 WebAV 加速，不兼容自动回退 FFmpeg。720p 样片可减少处理量；实际速度取决于设备与视频编码。' : settingEngine.value === 'webav' ? 'WebAV 使用系统编解码器，适合 MP4；若不兼容可切换自动或 FFmpeg。' : '内置单线程离线引擎，兼容多种格式。可选 720p 快速样片；音频默认直接复制。';
}
settingEngine.addEventListener('change', updateEngineHint);
updateEngineHint();

closeErrorBtn.addEventListener("click", () => {
  errorCard.style.display = "none";
});

function isVideo(file) {
  return VIDEO_TYPES.has(file.type) || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name);
}

function addFiles(newFiles) {
  if (busy || launchingBrowser) return;
  for (const file of newFiles) {
    if (isVideo(file) && !files.some((item) => item.name === file.name && item.size === file.size)) {
      files.push(file);
    }
  }
  renderFiles();
}

function formatSize(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
}

function renderFiles() {
  fileList.replaceChildren();
  if (!files.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "还没有选择视频";
    fileList.append(empty);
  } else {
    files.forEach((file, index) => {
      const item = document.createElement("li");
      const ext = (file.name.split('.').pop() || 'VIDEO').toUpperCase();
      const sizeStr = formatSize(file.size);
      item.innerHTML = `
        <span class="filename"></span>
        <div class="file-meta">
          <span class="file-badge">${ext} · ${sizeStr}</span>
          <button type="button" aria-label="移除视频">移除</button>
        </div>
      `;
      item.querySelector(".filename").textContent = file.name;
      item.querySelector("button").addEventListener("click", () => {
        if (busy) return;
        files.splice(index, 1);
        renderFiles();
      });
      fileList.append(item);
    });
  }
  startButton.disabled = !files.length;
  status.textContent = files.length ? `已选择 ${files.length} 个视频` : "等待选择视频";
}

function setProgress(value) {
  progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

async function startProcessing() {
  if (!files.length || startButton.disabled) return;
  busy = true;
  const run = activeRun = createProcessingRun();
  let completed = 0;
  stopButton.hidden = false; stopButton.disabled = false;
  document.querySelectorAll("select, #watermark-input, #watermark-reset, .file-list button").forEach(el => el.disabled = true);
  startButton.disabled = true;
  clearButton.disabled = true;
  input.disabled = true;
  errorCard.style.display = "none";
  errorSummary.textContent = "";
  errorLogContent.textContent = "";
  setProgress(0);

  const processors = createWatermarkProcessors({ FFmpeg, fetchFile, Combinator, MP4Clip, ImgClip, OffscreenSprite,
    publish: publishResult, status: text => { status.textContent = text; }, progress: setProgress,
    log: message => { ffmpegLogs.push(message); if (ffmpegLogs.length > 50) ffmpegLogs.shift(); },
  }, run, { engine: settingEngine.value, crf: settingCrf.value, audio: settingAudio.value, size: settingSize.value, watermarkUrl, hardware: externalSession ? 'prefer-hardware' : 'no-preference' });
  ffmpegLogs.length = 0;

  try {
    const totalStart = performance.now();

    for (let index = 0; index < files.length; index += 1) {
      run.check();
      await processors.process(files[index], index, files.length);
      run.check(); completed++;
    }

    const totalElapsed = ((performance.now() - totalStart) / 1000).toFixed(1);
    status.textContent = `全部完成（总耗时 ${totalElapsed}s），已发起下载；也可点击下方链接再次下载`;
    setProgress(100);
  } catch (error) {
    if (run.signal.aborted) { status.textContent = `已中断，完成 ${completed}/${files.length}；已完成样片保留在下方。可重新选择待处理视频后开始。`; return; }
    console.error(error);
    status.textContent = "处理失败，详细诊断结果已显示在下方";

    // Parse error logs to display user-friendly diagnostic message
    let reason = "处理过程中发生未知错误。";
    const errStr = String(error?.message || error || "");
    const logsTail = ffmpegLogs.slice(-25).join("\n");

    if (errStr.includes("GetDirectory") || errStr.includes("opfs") || errStr.includes("SecurityError")) {
      reason = "浏览器本地文件系统(OPFS)访问被拒绝。Firefox 等浏览器的严格防追踪/隐私保护功能可能会拦截本地高级缓存。建议：切换回“FFmpeg WASM (高兼容)”引擎，或使用 Chrome/Edge 浏览器体验极致硬件加速。";
    } else if (errStr.includes("SharedArrayBuffer") || logsTail.includes("SharedArrayBuffer")) {
      reason = "浏览器环境未开启 SharedArrayBuffer 多线程支持。建议刷新页面或在本地测试。";
    } else if (errStr.includes("memory") || errStr.includes("Out of Memory") || logsTail.includes("Out of Memory") || logsTail.includes("OOM")) {
      reason = "浏览器 WebAssembly 内存不足。处理过大或超高清视频时耗尽了内存，建议关闭其他标签页或处理较小的视频。";
    } else if (logsTail.includes("Invalid data found") || logsTail.includes("moov atom not found")) {
      reason = "视频文件数据损坏或格式不受支持，无法正常解码该视频。";
    } else if (errStr.includes("startsWith") || errStr.includes("Aborted") || logsTail.includes("Error")) {
      reason = "底层执行异常终止。通常是由于视频容器格式不规范或通道不支持导致。";
    } else {
      reason = `执行失败：${errStr}`;
    }

    errorSummary.textContent = `诊断原因：${reason}`;
    errorLogContent.textContent = [
      `[错误信息] ${errStr}`,
      `[系统堆栈] ${error?.stack || "无"}`,
      `\n--- 最近 25 行 FFmpeg 运行日志 ---`,
      logsTail || "(暂无 FFmpeg 日志)"
    ].join("\n");

    errorCard.style.display = "block";
    errorCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } finally {
    run.dispose(); activeRun = null; stopButton.hidden = true;
    startButton.disabled = !files.length;
    clearButton.disabled = false;
    input.disabled = false;
    busy = false;
    document.querySelectorAll("select, #watermark-input, #watermark-reset, .file-list button").forEach(el => el.disabled = false);
    if (!canUseMT) settingThreads.disabled = true;
  }
}

input.addEventListener("change", (event) => addFiles(event.target.files));
clearButton.addEventListener("click", () => {
  files.length = 0;
  input.value = "";
  renderFiles();
  setProgress(0);
});
startButton.addEventListener("click", () => { if (!launchingBrowser && !busy) { processingPromise = startProcessing(); void processingPromise.finally(() => { processingPromise = null; }); } });
stopButton.addEventListener('click', () => {
  if (!activeRun || !busy) return;
  stopButton.disabled = true; status.textContent = '正在中断处理…'; activeRun.cancel();
});
window.addEventListener('pagehide', () => { activeRun?.cancel(); });
["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
});
dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

const watermarkInput = document.querySelector('#watermark-input');
watermarkInput.addEventListener('change', () => { if(busy || launchingBrowser) return; const file = watermarkInput.files[0]; if(!file) return; watermarkFile=file; if(watermarkUrl.startsWith('blob:')) URL.revokeObjectURL(watermarkUrl); watermarkUrl=URL.createObjectURL(file);  document.querySelector('#watermark-preview').src=watermarkUrl; });
document.querySelector('#watermark-reset').addEventListener('click',()=>{ if(busy || launchingBrowser)return; watermarkFile=null; if(watermarkUrl.startsWith('blob:'))URL.revokeObjectURL(watermarkUrl);watermarkUrl=defaultWatermarkUrl;watermarkInput.value='';document.querySelector('#watermark-preview').src=watermarkUrl;});
window.addEventListener('message', event => { if(event.origin !== location.origin || event.source !== parent || event.data?.type !== 'xiaoma-theme')return; for(const [name,value] of Object.entries(event.data.values || {})){if(['bg','surface','raised','input','text','muted','border','accent','soft','on-accent','radius','control','scheme'].includes(name) && typeof value === 'string')document.documentElement.style.setProperty('--ui-'+name,value);}});

const completedUrls = new Set();
const processedBody = document.querySelector('#processed-body');
const toggleProcessed = document.querySelector('#toggle-processed');
const clearProcessed = document.querySelector('#clear-processed');
function setProcessedCollapsed(value) {
  processedBody.hidden = value; toggleProcessed.setAttribute('aria-expanded', String(!value)); toggleProcessed.textContent = value ? '展开 ⌄' : '收起 ⌃';
  try { localStorage.setItem('xm.watermark.processed-collapsed', String(value)); } catch { /* Optional preference. */ }
}
try { setProcessedCollapsed(localStorage.getItem('xm.watermark.processed-collapsed') === 'true'); } catch { /* Use default. */ }
toggleProcessed.addEventListener('click', () => setProcessedCollapsed(!processedBody.hidden));
clearProcessed.addEventListener('click', () => {
  for (const url of completedUrls) URL.revokeObjectURL(url); completedUrls.clear();
  document.querySelector('#output-list').replaceChildren(); document.querySelector('#processed-count').textContent = '0'; document.querySelector('#processed-empty').hidden = false; clearProcessed.disabled = true;
});
window.addEventListener('pagehide', () => { for (const url of completedUrls) URL.revokeObjectURL(url); completedUrls.clear(); });
function publishResult(blob, filename) {
  const url = URL.createObjectURL(blob); completedUrls.add(url);
  const row = document.createElement('article'); row.className = 'processed-task';
  const label = document.createElement('strong'); label.textContent = filename;
  const detail = document.createElement('small'); detail.textContent = `已完成 · ${formatSize(blob.size)} · ${new Date().toLocaleTimeString('zh-CN')}`;
  const link = document.createElement('a'); link.href = url; link.download = filename; link.textContent = '下载样片 ↓'; link.className = 'output-download';
  row.append(label, detail, link); document.querySelector('#output-list').prepend(row);
  document.querySelector('#processed-count').textContent = String(completedUrls.size); document.querySelector('#processed-empty').hidden = true; clearProcessed.disabled = false; link.click();
}

async function setupBrowserTools() {
  if (!bridge) return;
  document.querySelector('#browser-tools').hidden = false;
  const message = document.querySelector('#browser-status');
  try {
    const browsers = await bridge.getWatermarkBrowsers();
    for (const browser of browsers) {
      const button = document.querySelector(`#open-${browser.id}`);
      if (!button) continue;
      button.disabled = !browser.available;
      if (!browser.available) button.textContent += '（未安装）';
      button.addEventListener('click', async () => {
        if (launchingBrowser || !browser.available) return;
        launchingBrowser = true;
        document.querySelectorAll('.browser-actions button').forEach(el => { el.disabled = true; });
        const selectedFiles = [...files], selectedWatermark = watermarkFile;
        const settings = { engine: 'auto', size: settingSize.value, crf: settingCrf.value, audio: settingAudio.value };
        try {
          message.textContent = '正在准备浏览器任务…';
          if (activeRun) { activeRun.cancel(); if (processingPromise) await processingPromise; }
          const result = await bridge.openWatermarkBrowser({ browser: browser.id, files: selectedFiles, watermark: selectedWatermark, settings });
          message.textContent = `已在 ${result.browser} 打开，已带入 ${result.count} 个视频及水印设置。请到浏览器窗口点击“开始处理”。`;
        } catch (error) { message.textContent = error.message || '无法打开浏览器。'; }
        finally { launchingBrowser = false; for (const item of browsers) { const el = document.querySelector(`#open-${item.id}`); if (el) el.disabled = !item.available; } }
      });
    }
    message.textContent = browsers.some(item => item.available) ? '已选素材可直接交给浏览器，无需重新选择。' : '未检测到 Chrome / Edge，请安装后重新打开软件。';
  } catch (error) { message.textContent = error.message; }
}

async function setupBrowserSession() {
  if (!location.hash.includes('session=')) return;
  const info = document.querySelector('#browser-session-info'); info.hidden = false;
  info.textContent = '正在接收 XM剪辑台选择的素材和设置…';
  input.disabled = startButton.disabled = clearButton.disabled = true;
  try {
    const session = await loadBrowserSession(); externalSession = session; document.body.classList.add('external-watermark');
    files.push(...session.files);
    settingEngine.value = session.settings.engine; settingSize.value = session.settings.size;
    settingCrf.value = session.settings.crf; settingAudio.value = session.settings.audio;
    if (session.watermarkBlob) { watermarkUrl = URL.createObjectURL(session.watermarkBlob); document.querySelector('#watermark-preview').src = watermarkUrl; }
    updateEngineHint(); renderFiles();
    info.textContent = `${session.browser} · 已带入 ${session.files.length} 个视频。开始后优先请求硬件编码，实际加速取决于显卡和格式；请保持 XM剪辑台运行。成品保存在浏览器下载目录。`;
  } catch (error) { info.textContent = error.message || '连接软件失败，请从软件重新打开。'; }
  finally { input.disabled = clearButton.disabled = false; startButton.disabled = !files.length; }
}
void setupBrowserTools();
void setupBrowserSession();
