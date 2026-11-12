const randomUUID = () => globalThis.crypto.randomUUID();
import { webAIProvider } from '../shared/web-ai.mjs';
import { analyzeWithWeb, webTaskPrompt, webTaskResult } from '../shared/web-script-analysis.mjs';

export function createWebAnalysis({ driver, notify, copy, now = Date.now, delay = ms => new Promise(resolve => setTimeout(resolve, ms)), uuid = randomUUID, pageTimeoutMs = 15000 }) {
  let current = null;
  let lastAutoInputAt = null;
  const inputIntervalMs = 3000;
  const snapshot = () => current ? { id: current.id, provider: current.provider, stage: current.stage, message: current.message, prompt: current.prompt || '', token: current.token || '', manualWeb: !!current.manualWeb, requiresPaste: !!current.requiresPaste } : null;
  const update = values => { if (current && Object.entries(values).some(([key, value]) => current[key] !== value)) { Object.assign(current, values); notify(snapshot()); } };
  const check = task => { if (task.cancelled || current !== task) throw new Error('网页分析已中断。'); };
  async function paceInput(task) {
    check(task);
    const remaining = lastAutoInputAt === null ? 0 : inputIntervalMs - (now() - lastAutoInputAt);
    if (remaining <= 0) return;
    update({ message: '正在等待自动输入间隔。' });
    let cancel;
    const interrupted = new Promise((_, reject) => {
      cancel = () => reject(new Error('网页分析已中断。'));
      task.cancelWait = cancel;
    });
    try { await Promise.race([delay(remaining), interrupted]); check(task); }
    finally { if (task.cancelWait === cancel) task.cancelWait = null; }
  }
  async function runPage(task, input) {
    check(task);
    let timer;
    const controller = new AbortController();
    const interrupted = new Promise((_, reject) => {
      const interrupt = error => { reject(error); controller.abort(error); };
      task.cancelWait = () => interrupt(new Error('网页分析已中断。'));
      timer = setTimeout(() => interrupt(Object.assign(new Error('网页响应超时。'), { pageTimeout: true })), pageTimeoutMs);
    });
    try { return await Promise.race([driver.run(task.provider, input, controller.signal), interrupted]); }
    finally { clearTimeout(timer); task.cancelWait = null; }
  }
  async function ask(task, messages, stage) {
    check(task);
    const token = uuid(), prompt = webTaskPrompt(messages, token);
    const requiresPaste = task.manualWeb && /^(批量匹配|联合补充与纠正)/.test(stage);
    update({ stage, token, prompt, manualResult: null, manualMode: false, requiresPaste, message: '正在准备网页，请在官网完成登录。' });
    let filled = false, attempted = false, stable = '', stableCount = 0;
    const deadline = now() + (task.manualWeb ? 60 : 8) * 60 * 1000;
    while (now() < deadline) {
      check(task);
      if (task.manualResult) return task.manualResult;
      if (task.manualMode) attempted = true;
      if (driver.visible(task.provider)) {
        try {
          if (!filled && !attempted) {
            await paceInput(task);
            const value = await runPage(task, { command: 'fill', prompt, token });
            check(task);
            if (value.state === 'limited') throw Object.assign(new Error(value.message), { limited: true });
            if (value.state === 'filled') { lastAutoInputAt = now(); filled = true; update({ message: task.manualWeb ? (requiresPaste ? '音乐匹配提示词已填入。请手动发送，再将 DeepSeek 的完整回答复制到「音乐推荐结果」并点击导入。' : '剧本提示词已填入；请检查后手动发送，回答完成后会生成下一步提示词。') : '任务已完整填入，正在提交网页分析。' }); }
            else { if (value.state === 'manual') attempted = true; update({ message: value.message || '请在官网完成登录后继续。' }); }
          } else if (!attempted && !task.manualWeb) {
            // Never automatically re-send after an uncertain click or navigation.
            await paceInput(task);
            attempted = true;
            const value = await runPage(task, { command: 'send', prompt, token });
            check(task);
            if (value.state === 'limited') throw Object.assign(new Error(value.message), { limited: true });
            if (value.state === 'sent') lastAutoInputAt = now();
            update({ message: value.state === 'sent' ? '等待网页回答，完成后自动接回配乐流程。' : value.message || '请在网页点击发送，回答完成后会自动读取。' });
          }
          if (requiresPaste) {
            await delay(1500);
            continue;
          }
          const result = await runPage(task, { command: 'read', prompt, token });
          check(task);
          if (result.state === 'limited') throw Object.assign(new Error(result.message), { limited: true });
          const candidates = (result.texts || []).map(text => webTaskResult(text, token)).filter(Boolean);
          const candidate = candidates.at(-1) || '';
          stableCount = candidate && candidate === stable && !result.busy ? stableCount + 1 : 0;
          stable = candidate;
          if (candidate && stableCount >= 2 && !result.busy) return candidate;
        } catch (error) {
          check(task);
          if (error.limited) throw error;
          if (error.pageTimeout) {
            attempted = true;
            update({ message: '网页响应超时，已停止自动提交。可中断分析，或复制任务后手动发送并粘贴结果继续。' });
          } else update({ message: '网页尚未就绪，或登录/页面结构发生变化。可完成登录，或复制任务后手动粘贴结果继续。' });
        }
      }
      await delay(1500);
    }
    throw new Error('网页分析等待超时。请检查登录、额度及网页提示后重试。');
  }
  return {
    snapshot,
    async run(request) {
      if (current) throw new Error('已有网页分析任务，请先完成或中断当前任务。');
      if (!request || typeof request.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(request.id)) throw new Error('网页任务标识无效。');
      webAIProvider(request.provider);
      const task = { id: request.id, provider: request.provider, manualWeb: request.provider === 'deepseek' && request.manualWeb === true, cancelled: false };
      current = task;
      try { return await analyzeWithWeb(request.purpose, request.input, (messages, stage) => ask(task, messages, stage)); }
      catch (error) { throw new Error((error.message || '网页分析失败。').replaceAll('Gemini', webAIProvider(task.provider).name)); }
      finally { if (current === task) { current = null; notify(null); } }
    },
    async action(id, action, value) {
      if (!current || current.id !== id) { if (action === 'cancel') return null; throw new Error('网页分析任务已结束。'); }
      if (action === 'cancel') { current.cancelled = true; current.cancelWait?.(); update({ message: '正在中断；网页已发送的对话可在官网保留。' }); return null; }
      if (action === 'copy') { current.manualMode = true; return copy(current.prompt); }
      if (action === 'import') {
        if (current.manualWeb && !current.requiresPaste) throw new Error('请等待音乐匹配提示词出现，再粘贴音乐推荐回答。');
        const result = webTaskResult(value, current.token, true);
        if (!result) throw new Error('没有找到本次任务的完整 JSON 结果，请粘贴完整回答。');
        if (current.manualWeb) update({ manualResult: result, requiresPaste: false, message: '已接收音乐推荐，正在校验曲目与推荐理由。' });
        else current.manualResult = result;
        return { accepted: true };
      }
      throw new Error('未知网页分析操作。');
    },
    dispose() { if (current) { current.cancelled = true; current.cancelWait?.(); } },
  };
}
