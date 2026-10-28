// This source executes only against the visible official page DOM, never cookies,
// site application state, internal endpoints or the main app's privileged bridge.
const page = String.raw`(input => {
  if (input.host && (location.protocol !== 'https:' || location.hostname !== input.host)) return { state: 'login', message: '请返回官方对话页面后继续。' };
  const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).opacity !== '0' && !node.closest('[hidden],[aria-hidden="true"]');
  const alerts = [...document.querySelectorAll('[role="alert"],[class*="toast"],[class*="message-error"],[data-testid*="toast"]')].filter(visible).map(node => node.innerText || '').join(' ');
  const limited = /访问频繁|请求过于频繁|操作频繁|请求频繁|too many requests|rate limit|额度.*(?:用完|耗尽|不足)/i.test(alerts);
  const buttons = [...document.querySelectorAll('button,[role="button"],a')].filter(visible);
  const login = buttons.find(node => /^(登录|登录[ /·]?注册|登录账号|立即登录|log in|sign in)$/i.test((node.getAttribute('aria-label') || node.innerText || '').trim()));
  const access = limited ? { state: 'limited', message: '官网提示访问频繁或额度受限。本次不会自动重发，请稍后按官网提示重试；可先确认账号已登录。' } : login ? { state: 'login', message: '当前官网账号未登录，请点击网页右上角“登录”完成登录。' } : { state: 'ready', message: '' };
  if (input.command === 'login') { if (login) { login.click(); return { state: 'login', message: '请在官方页面完成账号登录。' }; } return access; }
  if (input.command === 'probe') return access;
  if (access.state !== 'ready') return access;
  const editors = [...document.querySelectorAll('textarea,[contenteditable="true"][role="textbox"],[contenteditable="true"]')].filter(node => visible(node) && !node.disabled && !node.readOnly);
  const editor = editors[editors.length - 1];
  const value = node => (node?.value ?? node?.innerText ?? '').replace(/\r\n?/g, '\n');
  const fill = () => {
    if (!editor) return { state: 'login', message: '请先在官方网页登录，登录完成后将自动继续。' };
    if (value(editor).trim() && value(editor) !== input.prompt) return { state: 'draft', message: '网页输入框有未发送内容，请先处理或清空，再继续分析。' };
    editor.focus();
    if (editor.tagName === 'TEXTAREA') Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, input.prompt);
    else {
      const range = document.createRange(); range.selectNodeContents(editor);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.execCommand('insertText', false, input.prompt);
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: input.prompt }));
    return value(editor) === input.prompt ? { state: 'filled' } : { state: 'manual', message: '网页未接受完整文本，请用复制任务按钮粘贴并发送。' };
  };
  if (['prepare-image', 'upload-image', 'image-ready'].includes(input.command)) {
    if (!editor) return { state: 'login', message: '请在 DeepSeek 扫描窗口登录后继续。' };
    // Image attachments may show only a thumbnail, with neither a filename nor
    // a retained file input. Keep observations scoped to the current composer.
    let composer = editor.closest('form,[role="form"]');
    const editorBox = editor.getBoundingClientRect();
    for (let node = composer ? null : editor.parentElement; node && node !== document.body; node = node.parentElement) {
      const box = node.getBoundingClientRect();
      if (box.height > Math.max(600, editorBox.height + 350) || box.width > Math.max(900, editorBox.width + 280)) break;
      composer = node;
      if (node.querySelector('input[type="file"]') && buttons.some(button => node.contains(button))) break;
    }
    composer ||= editor.parentElement;
    const media = [...composer.querySelectorAll('img,canvas,div,span')].filter(visible).flatMap(node => {
      if (node.tagName === 'IMG') return node.currentSrc || node.src ? [{ key: node.currentSrc || node.src, loaded: node.complete && node.naturalWidth > 0 }] : [];
      if (node.tagName === 'CANVAS') return [{ key: 'canvas:' + node.width + ':' + node.height, loaded: node.width > 0 && node.height > 0 }];
      const background = getComputedStyle(node).backgroundImage;
      return background && background !== 'none' ? [{ key: background, loaded: true }] : [];
    });
    // Never scan an ancestor's textContent: it includes invisible textarea sizing
    // mirrors and previous conversation prompts containing our example error.
    const uploadFailure = /^(?:(?:图片|文件|附件|截图)\s*)?(?:上传失败|解析失败|读取失败|处理失败)(?:[，。：:!！\s]|$)|^(?:文件|图片|附件)格式不支持|^(?:不支持的(?:图片|文件)|无法(?:上传|读取|解析)(?:该|此|这个)?(?:图片|文件|附件))|^(?:(?:file|image|attachment)\s+)?(?:upload|parse|processing|read)(?:ing)?\s+(?:failed|error)|^unsupported\s+(?:image|file)/i;
    const excludedStatus = 'textarea,[contenteditable],pre,code,article,[class*="markdown"],[data-message-author-role],[data-testid*="message"]';
    const statusNodes = [...document.querySelectorAll('[role="alert"],[class*="toast"],[class*="upload-error"],[class*="file-error"]'), ...composer.querySelectorAll('span,div')];
    const errorText = statusNodes.filter(node => visible(node) && !node.contains(editor) && !node.closest(excludedStatus)).map(node => (node.innerText || '').trim()).find(text => text.length <= 180 && uploadFailure.test(text));
    if (errorText) return { state: 'unsupported', message: 'DeepSeek 截图上传失败：' + errorText.slice(0, 160) };
    if (input.command === 'image-ready') {
      const named = [...composer.querySelectorAll('[title],[aria-label],span,div')].some(node => visible(node) && (node.getAttribute('title') === input.filename || node.getAttribute('aria-label') === input.filename || node.textContent?.trim() === input.filename));
      const receipt = input.upload;
      const thumbnail = receipt?.filename === input.filename && Array.isArray(receipt.before) && media.some(item => item.loaded && !receipt.before.includes(item.key));
      const uploading = [...composer.querySelectorAll('[role="progressbar"],[aria-busy="true"],[class*="uploading"],[class*="file-loading"],[class*="loading"],[class*="spinner"]')].some(visible);
      const send = buttons.find(node => composer.contains(node) && /^(发送|发送消息|send|send message)$/i.test((node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim()));
      const blocked = send && (send.disabled || send.getAttribute('aria-disabled') === 'true');
      return (named || thumbnail) && !uploading && !blocked ? { state: 'ready' } : { state: 'uploading', message: 'DeepSeek 正在处理截图；如官网显示失败，请中断后重试。' };
    }
    const files = [...document.querySelectorAll('input[type="file"]')].filter(node => !node.disabled && (!node.accept || /image|\.jpe?g|\.png/i.test(node.accept)));
    if (!files.length) return { state: 'unsupported', message: '当前 DeepSeek 页面未提供图片上传，请切换支持图片的模式或使用 Gemini。' };
    if (buttons.some(node => /^(停止|停止生成|停止回答|停止思考|stop|stop generating|stop response)$/i.test((node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim()))) return { state: 'draft', message: 'DeepSeek 正在回答其他问题，请等待完成或在网页中停止回答后重新扫描。' };
    if (value(editor).trim() || files.some(node => node.files?.length) || media.some(item => /^(blob:|data:image|url\(["']?(blob:|data:image)|canvas:)/.test(item.key))) return { state: 'draft', message: 'DeepSeek 页面有未发送内容或附件，请先处理后重新扫描。' };
    if (!/^xm-drafts-[a-zA-Z0-9-]+\.jpg$/.test(input.filename) || !/^[A-Za-z0-9+/=]+$/.test(input.image || '') || input.image.length > 12000000) return { state: 'manual', message: '截图格式无效。' };
    if (input.command === 'prepare-image') {
      if (typeof input.prompt !== 'string' || !input.prompt || input.prompt.length > 170000) return { state: 'manual', message: '截图识别任务文本无效。' };
      const filled = fill();
      if (filled.state !== 'filled') return filled;
    }
    const bytes = Uint8Array.from(atob(input.image), char => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], input.filename, { type: 'image/jpeg' }));
    const fileInput = files[0]; fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    return { state: 'uploaded', upload: { filename: input.filename, before: media.map(item => item.key) } };
  }
  if (input.command === 'fill') return fill();
  if (input.command === 'send') {
    if (!editor || value(editor) !== input.prompt) return { state: 'manual', message: '输入内容已变化，请核对后在网页发送。' };
    editor.focus();
    const send = buttons.find(node => /^(发送|发送消息|send|send message)$/i.test((node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim()));
    if (send) {
      if (send.disabled || send.getAttribute('aria-disabled') === 'true') return { state: 'manual', message: '网页暂不可发送，请完成登录或检查网页额度提示。' };
      send.click(); return { state: 'sent' };
    }
    return { state: 'enter' };
  }
  const excluded = '[class*="think"],[data-testid*="think"],[data-message-author-role="user"],[hidden],[aria-hidden="true"]';
  const nodes = [...document.querySelectorAll('pre,code,[class*="markdown"],[data-message-author-role="assistant"],[data-testid*="message_text"],[class*="message-content"],article')];
  const answerText = node => {
    // Broad message containers can include both reasoning and the final answer.
    // Remove excluded descendants from a clone, never from the official page.
    if (node.querySelector?.(excluded)) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll(excluded).forEach(child => child.remove());
      return clone.textContent || '';
    }
    return node.innerText || node.textContent || '';
  };
  const texts = [...new Set(nodes.filter(node => visible(node) && !node.closest(excluded)).map(answerText).filter(text => text.includes(input.token) && text.length <= 200000 && !text.includes(input.prompt) && !text.includes('这里放入上面要求的完整结果对象')))].slice(-20);
  const busyButton = buttons.some(node => /^(停止|停止生成|停止回答|停止思考|思考中|正在思考|stop|stop generating|stop response)$/i.test((node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim()));
  // Match active states rather than substrings such as "not-streaming" on completed replies.
  const busyStream = [...document.querySelectorAll('[data-streaming="true"],.streaming,.is-streaming')].some(node => visible(node) && node.getAttribute('data-streaming') !== 'false' && !/^(done|completed|idle)$/.test(node.getAttribute('data-state') || ''));
  return { texts, busy: busyButton || busyStream, pendingPrompt: Boolean(editor && value(editor) === input.prompt) };
})`;

export function webAIPageScript(input) { return `${page}(${JSON.stringify(input)})`; }
