// DSH exposes composer/chat attributes in its rendered UI. Only those visible
// elements are used; no account storage, private endpoints or application state.
function operate(input) {
  const login = { state: 'login', message: '请在公司 DSH 页面完成飞书登录，并进入自己的对话工作区。' };
  let entry;
  try { entry = new URL(input.entryUrl); } catch { return login; }
  if (location.hostname !== entry.hostname || location.protocol !== entry.protocol || /^\/(auth|api)(\/|$)/i.test(location.pathname)) return login;
  const visible = node => node && node.getClientRects().length > 0 &&
    (!node.checkVisibility || node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) &&
    getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).opacity !== '0' && !node.closest('[hidden],[aria-hidden="true"]');
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  if (input.command === 'read' && typeof input.token === 'string' && input.token) {
    // A turn failure is a service status, not an assistant answer. Match the
    // current task's user turn so old errors and quoted error text are ignored.
    const users = all('[data-chat-flow-kind="user"]').filter(node => (node.innerText || '').includes(input.token));
    const user = users.at(-1), turn = user?.getAttribute('data-chat-turn');
    if (turn !== null && turn !== undefined && turn !== '') {
      const flow = user.closest('[data-slot="conversation.chat.flow"],[data-chat-flow],[data-conversation-scroll]') || document;
      const failure = all('[data-chat-flow-kind="turn-error"]', flow).filter(node =>
        node.getAttribute('data-chat-turn') === turn &&
        !node.closest('[data-chat-flow-kind="user"],[data-chat-flow-kind="assistant"],[data-chat-group-part="reasoning"],[data-variant="think"]')).at(-1);
      if (failure) {
        const detail = (all('[class*="turnErrorMessage"]', failure).map(node => node.innerText || '').join(' ') || failure.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 1500);
        const configuration = /(?:unknown|malformed) prompt variable|prompt variable .* has no value/i.test(detail);
        return { state: 'failed', message: `公司 DSH 本轮运行失败：${detail || '服务未完成本轮请求。'}\n${configuration ? 'DSH 部署提示词配置有误，请联系公司技术部修正后重试。' : '请处理网页中的错误后重新开始分析。'}剪辑台已停止等待，不会自动重发。` };
      }
    }
  }
  const editors = all('[data-composer-input][contenteditable="true"],textarea[data-composer-input]');
  if (editors.length !== 1) return { ...login, message: editors.length ? '发现多个 DSH 输入框，请关闭额外对话后继续。' : login.message };
  const editor = editors[0], composer = editor.closest('[data-composer-card]');
  if (!composer || editor.disabled || editor.readOnly || editor.getAttribute('aria-disabled') === 'true') return login;
  const alerts = all('[role="alert"],[class*="toast"],[class*="message-error"]').map(node => node.innerText || '').join(' ');
  if (/请求过于频繁|访问频繁|请求频繁|rate limit|too many requests|额度.*(?:耗尽|不足|用完)/i.test(alerts))
    return { state: 'limited', message: '公司 DSH 提示限流或额度不足，已停止自动提交，请联系公司管理员确认。' };
  const buttons = all('button,[role="button"]', composer);
  const label = node => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim();
  const busy = buttons.some(node => /^(停止|停止生成|停止回答|中断|stop|stop generating|stop response)$/i.test(label(node))) ||
    all('[data-chat-running],[data-streaming="true"]').length > 0 || buttons.some(node => node.getAttribute('aria-busy') === 'true');
  const value = () => (editor.value ?? editor.innerText ?? '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  // Chromium innerText can render an empty paragraph as three newlines although
  // the pasted text has two. Compare only those visual paragraph separators;
  // never ignore words, punctuation, spaces within lines or task identifiers.
  const samePrompt = () => value() === input.prompt || editor.isContentEditable &&
    value().replace(/\n{2,}/g, '\n\n') === (input.prompt || '').replace(/\n{2,}/g, '\n\n');
  if (input.command === 'probe' || input.command === 'login') return { state: 'ready', message: busy ? 'DSH 正在回答，请等待完成。' : '公司 DSH 已就绪：开始分析后自动填入、发送并读取回答。' };
  if (input.command === 'fill') {
    if (busy) return { state: 'draft', message: 'DSH 正在回答其他问题，完成后自动继续。' };
    if (typeof input.prompt !== 'string' || !input.prompt || input.prompt.length > 200000) return { state: 'manual', message: '分析提示词过长或为空，请减少本轮集数。' };
    if (value().trim() && !samePrompt()) return { state: 'draft', message: 'DSH 输入框有未发送内容，请先处理或清空；不会覆盖你的草稿。' };
    if (all('[data-composer-chip],[data-composer-quote]', composer).length) return { state: 'draft', message: 'DSH 输入框有引用或附件，请先处理后继续分析。' };
    editor.focus();
    if (!samePrompt()) {
      if (editor.tagName === 'TEXTAREA') Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, input.prompt);
      else {
        // Lexical's normal paste handler keeps its editor state in sync.
        if (typeof ClipboardEvent === 'function' && typeof DataTransfer === 'function') {
          const transfer = new DataTransfer(); transfer.setData('text/plain', input.prompt);
          const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
          editor.dispatchEvent(paste);
          if (paste.defaultPrevented && !samePrompt()) return { state: 'input-pending', message: '正在等待 DSH 输入框完成粘贴。' };
        }
        if (!value().trim()) {
          const range = document.createRange(); range.selectNodeContents(editor);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.execCommand('insertText', false, input.prompt);
        }
      }
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: input.prompt }));
    }
    return samePrompt() ? { state: 'filled' } : { state: 'manual', message: 'DSH 未接受完整提示词，请使用“复制当前任务”粘贴后继续。' };
  }
  if (input.command === 'send') {
    if (busy || !samePrompt()) return { state: 'manual', message: 'DSH 正在回答或输入内容已变化，请核对后手动发送。' };
    const send = buttons.find(node => /^(发送|发送消息|提交|send|send message|submit)(?:\s*[（(].*[）)])?$/i.test(label(node)));
    if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true') return { state: 'manual', message: '尚未找到可用的 DSH 发送按钮，请在网页确认后手动发送。' };
    send.click(); return { state: 'sent' };
  }
  if (input.command !== 'read') return { state: 'manual', message: '公司 DSH 当前仅支持文字剧本分析。' };
  const excluded = '[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"],[data-chat-group-part="reasoning"],[data-variant="think"],[data-message-bubble],[data-system-prompt-body],[hidden],[aria-hidden="true"]';
  const nodes = all('[data-chat-group-part="response"],[data-chat-flow-kind="assistant"]');
  const texts = [...new Set(nodes.filter(node => !node.closest(excluded)).map(node => {
    const copy = node.cloneNode(true); copy.querySelectorAll(excluded).forEach(child => child.remove());
    return copy.textContent || '';
  }).filter(text => text.includes(input.token) && text.length <= 200000 && !text.includes(input.prompt) && !text.includes('这里放入上面要求的完整结果对象')))].slice(-12);
  return { texts, busy, pendingPrompt: samePrompt() };
}

export function companyDSHPageScript(input) { return `(${operate.toString()})(${JSON.stringify(input)})`; }
