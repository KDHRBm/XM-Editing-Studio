const randomUUID = () => globalThis.crypto.randomUUID();
import { webTaskPrompt, webTaskResult } from '../shared/web-script-analysis.mjs';

const scanResult = (text, token, manual = false) => webTaskResult(text, token, manual, ['heading', 'drafts', 'error']);

// Share the domestic-AI tab's visible WebContentsView, login and conversation.
// Ending a scan releases its task; it never closes the user's page.
export function createJianyingWebScan({ driver, notify = () => {}, copy, isBusy = () => false, now = Date.now, delay = ms => new Promise(resolve => setTimeout(resolve, ms)), uuid = randomUUID, pageTimeoutMs = 15000, uploadTimeoutMs = 90000 }) {
  let current = null, pending = false, disposed = false;
  const snapshot = () => current ? { id: current.id, provider: 'deepseek', kind: 'draft-scan', stage: '草稿截图识别', message: current.message, prompt: current.prompt, token: current.token } : null;
  const update = (task, message) => { if (current === task && task.message !== message) { task.message = message; notify(snapshot()); task.report(message); } };
  const close = () => { const task = current; current = null; if (task) { task.cancelled = true; task.cancelWait?.(); notify(null); } };
  return {
    snapshot,
    close,
    dispose() { disposed = true; close(); },
    async action(id, action, value) {
      const task = current;
      if (!task || task.id !== id) { if (action === 'cancel') return null; throw new Error('草稿扫描任务已结束。'); }
      if (action === 'cancel') { close(); return null; }
      if (action === 'copy') {
        if (!copy) throw new Error('当前任务复制不可用。');
        task.manual = true;
        update(task, '请将完整任务粘贴到下方 DeepSeek，确认截图附件后发送；回答会自动读取。');
        return copy(task.prompt);
      }
      if (action === 'import') {
        const result = scanResult(value, task.token, true);
        if (!result) throw new Error('没有找到完整 JSON 结果，请粘贴本次截图识别的完整回答。');
        task.manualResult = result; return { accepted: true };
      }
      throw new Error('未知草稿扫描操作。');
    },
    async request(input, signal, report = () => {}) {
      if (disposed) throw new Error('草稿扫描已关闭。');
      if (pending || isBusy()) throw new Error('已有网页分析任务，请先完成或中断当前任务。');
      if (!signal || signal.aborted) throw new Error('扫描已中断。');
      if (typeof input.prompt !== 'string' || !input.prompt || input.prompt.length > 150000 || typeof input.image !== 'string' || !input.image || input.image.length > 12000000 || !/^[A-Za-z0-9+/=]+$/.test(input.image)) throw new Error('草稿截图格式无效。');
      const token = uuid(), filename = `xm-drafts-${token}.jpg`;
      const prompt = webTaskPrompt([{ content: input.prompt + '\nRead the attached screenshot visually, including layout and thumbnail positions. If the required Drafts heading is absent, return {"heading":null} instead of null. If visual understanding is unavailable, return {"error":"当前模型无法识别图片布局，请切换支持视觉的模型或使用 Gemini"}. Do not guess coordinates from OCR text alone.' }], token);
      const task = { id: token, token, prompt, report, message: '', manual: false, cancelled: false };
      pending = true; current = task;
      const check = () => { if (signal.aborted || task.cancelled || current !== task) throw new Error('扫描已中断。'); };
      const run = async command => {
        check();
        let timer, abort;
        try {
          const interrupted = new Promise((_, reject) => {
            abort = task.cancelWait = () => reject(new Error('扫描已中断。'));
            signal.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => reject(new Error('DeepSeek 页面响应超时，已停止自动提交。请中断后重新扫描。')), pageTimeoutMs);
          });
          return await Promise.race([driver.run('deepseek', command, signal), interrupted]);
        } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); task.cancelWait = null; }
      };
      const parse = candidate => { const parsed = JSON.parse(candidate); if (parsed.error) throw new Error(String(parsed.error).slice(0, 300)); return candidate; };
      try {
        update(task, '已截取剪映页面，正在使用“国内 AI”中的 DeepSeek 页面。请在下方完成登录。');
        let prepared = false, upload, uploadDeadline = 0, readyCount = 0, attempted = false, sentAt = 0, stable = '', stableCount = 0;
        const deadline = now() + 8 * 60 * 1000;
        while (now() < deadline) {
          check();
          if (task.manualResult) return parse(task.manualResult);
          if (!driver.visible('deepseek')) { await delay(250); continue; }
          if (!task.manual && !prepared) {
            // Write the question before uploading, independently of thumbnail detection.
            const result = await run({ command: 'prepare-image', image: input.image, filename, prompt, token });
            if (['limited', 'unsupported', 'draft', 'manual'].includes(result.state)) throw new Error(result.message);
            prepared = result.state === 'uploaded';
            if (prepared) { upload = result.upload; uploadDeadline = now() + uploadTimeoutMs; }
            update(task, prepared ? '提示词已完整填入，截图已附上，正在等待网页允许发送。' : result.message || '请在下方 DeepSeek 页面完成登录。');
          } else if (!task.manual && !attempted) {
            const attachment = await run({ command: 'image-ready', filename, upload, prompt });
            if (['limited', 'unsupported', 'draft'].includes(attachment.state)) throw new Error(attachment.message);
            readyCount = attachment.state === 'ready' ? readyCount + 1 : 0;
            if (readyCount >= 2) {
              attempted = true; // Never repeat an uncertain submission.
              const sent = await run({ command: 'send', prompt, token });
              sentAt = now();
              if (sent.state === 'limited') throw new Error(sent.message);
              if (sent.state !== 'sent') {
                task.manual = true;
                update(task, sent.message || '请在下方 DeepSeek 点击发送；回答完成后会自动读取。');
              } else update(task, 'DeepSeek 已提交截图识别，回答完成后自动接回草稿列表。按 F10 可中断。');
            } else if (now() >= uploadDeadline) {
              task.manual = true;
              update(task, '无法确认截图上传状态，已停止自动发送。请在下方 DeepSeek 核对附件后点击发送，回答会自动读取。');
            }
          }
          if (prepared || task.manual) {
            const result = await run({ command: 'read', prompt, token });
            if (['limited', 'login'].includes(result.state)) throw new Error(result.message);
            if (attempted && !task.manual && result.pendingPrompt && !result.busy && now() - sentAt > 15000) {
              task.manual = true;
              update(task, '网页未接受自动发送。请点击下方 DeepSeek 的发送箭头，回答完成后会自动读取。');
            }
            const candidate = (result.texts || []).map(text => scanResult(text, token)).filter(Boolean).at(-1) || '';
            if (prepared && result.pendingPrompt === false && !attempted && (result.busy || candidate)) { attempted = true; sentAt = now(); }
            stableCount = candidate && candidate === stable && !result.busy ? stableCount + 1 : 0;
            stable = candidate;
            if (candidate && stableCount >= 2 && !result.busy) return parse(candidate);
          }
          await delay(1200);
        }
        throw new Error('DeepSeek 扫描等待超时，请检查官网登录、图片支持和回答内容后重试。');
      } finally { pending = false; }
    },
  };
}
