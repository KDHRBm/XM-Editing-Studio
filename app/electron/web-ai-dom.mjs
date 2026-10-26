// This source executes only against the visible official page DOM, never cookies,
// site application state, internal endpoints or the main app's privileged bridge.
const page = String.raw`(input => {
  if (input.host && (location.protocol !== 'https:' || location.hostname !== input.host)) return { state: 'login', message: '请返回官方对话页面后继续。' };
  const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[hidden],[aria-hidden="true"]');
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
  if (input.command === 'fill') {
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
  }
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
  const nodes = [...document.querySelectorAll('pre,code,[class*="markdown"],[data-message-author-role="assistant"],[data-testid*="message_text"]')];
  const texts = [...new Set(nodes.filter(visible).map(node => node.innerText || '').filter(text => text.includes(input.token) && text.length <= 200000 && !text.includes(input.prompt)))].slice(-20);
  const busy = [...document.querySelectorAll('button,[role="button"]')].filter(visible).some(node => /^(停止|停止生成|停止回答|stop|stop generating|stop response)$/i.test((node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim()));
  return { texts, busy };
})`;

export function webAIPageScript(input) { return `${page}(${JSON.stringify(input)})`; }
