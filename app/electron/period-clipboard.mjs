import { normalizeSubtitlePunctuation } from '../shared/period-text.mjs';

// Same visible substitutions as JianYing-Period-Keeper. Never add zero-width joins.
export function protectPunctuation(text) {
  return String(text).replaceAll('\u2060', '').replace(/[ \t\u3000]*(\.{2,}|[.,。，])/g, (token, punctuation) => {
    if (/^\.{2,}$/.test(punctuation)) return token;
    return { '.': '․', ',': '‚', '。': '﹒', '，': '﹐' }[punctuation];
  });
}
export function restoreProtectedPunctuation(text) {
  return String(text).replaceAll('\u2060', '').replace(/[․‚﹒﹐]/g, char => ({ '․': '.', '‚': ',', '﹒': '。', '﹐': '，' })[char]);
}

export function createPunctuationClipboard({ clipboard, schedule = setInterval, cancel = clearInterval, retryDelay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let enabled = false, mode = 'compatible', timer, owned = null, lastSeen = null, error = '', epoch = 0, writing = null;
  const status = () => ({ punctuationMode: mode, clipboardProtected: enabled && mode === 'compatible' && !error, clipboardError: error });
  const canonical = text => String(text).replace(/\r\n?/g, '\n');
  const nonTextCopy = () => clipboard.availableFormats?.().some(format => /image|file|uri-list|hdrop/i.test(format));
  async function writeVerified(original, output) {
    const operation = ++epoch;
    writing = operation;
    const windowsText = canonical(output).replace(/\n/g, '\r\n');
    let observed;
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        if (operation !== epoch) throw new Error('复制设置已变化，请重新复制台词。');
        try {
          const current = canonical(clipboard.readText());
          if (attempt && observed !== undefined && (nonTextCopy() || current !== observed && current !== canonical(output))) throw Object.assign(new Error('剪贴板已被其他复制操作更新，请重新点击复制到剪映。'), { superseded: true });
          clipboard.writeText(windowsText);
          observed = canonical(clipboard.readText());
          if (observed === canonical(output)) {
            lastSeen = observed; error = '';
            owned = canonical(output) !== canonical(original) ? { original, protected: observed } : null;
            return { ...status(), copyVerified: true, copiedCharacters: [...canonical(original)].length, copiedLines: canonical(original).split('\n').filter(line => line.trim()).length };
          }
        } catch (failure) { if (failure.superseded) throw failure; }
        if (attempt < 5) await retryDelay(30);
      }
      throw new Error('剪贴板完整性校验未通过，未确认复制成功。请关闭其他剪贴板工具后重新复制。');
    } catch (failure) {
      if (operation === epoch) { error = failure.message; lastSeen = null; }
      throw failure;
    } finally { if (writing === operation) writing = null; }
  }
  function restoreOwned() {
    if (owned && !nonTextCopy() && canonical(clipboard.readText()) === owned.protected) clipboard.writeText(canonical(owned.original).replace(/\n/g, '\r\n'));
    owned = null; lastSeen = null;
  }
  function poll() {
    if (writing !== null) return;
    try {
      // Do not replace images or Explorer file copies with plain text.
      if (nonTextCopy()) return;
      const text = canonical(clipboard.readText());
      if (text === lastSeen) return;
      lastSeen = text; owned = null;
      if (!text || text.length > 120000) return;
      const protectedText = protectPunctuation(text);
      if (protectedText !== text) {
        void writeVerified(restoreProtectedPunctuation(text), protectedText).catch(() => {});
      } else error = '';
    } catch { error = '剪贴板暂时被占用，请重新复制台词。'; }
  }
  function configure(nextEnabled, nextMode = mode) {
    if (typeof nextEnabled !== 'boolean' || !['standard', 'compatible'].includes(nextMode)) throw new Error('无效的标点保护设置。');
    if (timer != null) cancel(timer);
    timer = null;
    epoch++; writing = null;
    if (!nextEnabled || nextMode !== 'compatible') {
      try { restoreOwned(); error = ''; } catch { error = '剪贴板暂时被占用，请重新复制台词。'; }
    }
    enabled = nextEnabled; mode = nextMode;
    if (enabled && mode === 'compatible') { poll(); timer = schedule(poll, 100); timer?.unref?.(); }
    return status();
  }
  return {
    status, configure,
    async copyPlain(text) {
      if (typeof text !== 'string' || text.length > 1000000 || text.includes('\0')) throw new Error('复制内容过长或格式无效。');
      // Explicit non-subtitle copies must remain valid JSON and retain original punctuation.
      // writeVerified records lastSeen so the compatibility poll will leave this copy intact.
      return writeVerified(text, text);
    },
    async copy(text) {
      if (typeof text !== 'string' || text.length > 120000) throw new Error('字幕台词过长或格式无效。');
      // CF_UNICODETEXT terminates at NUL. Remove that nonprinting artifact before writing.
      const original = canonical(normalizeSubtitlePunctuation(text.replaceAll('\0', '')));
      const output = enabled && mode === 'compatible' ? protectPunctuation(original) : original;
      return writeVerified(original, output);
    },
    dispose() { return configure(false); },
  };
}
