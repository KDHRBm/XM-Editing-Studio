import { normalizeSubtitlePunctuation } from '../shared/period-text.mjs';

// Same visible substitutions as JianYing-Period-Keeper. Never add zero-width joins.
export function protectPunctuation(text) {
  return String(text).replaceAll('\u2060', '').replace(/[ \t\u3000]*(\.{2,}|[.,。，])/g, (token, punctuation) => {
    if (/^\.{2,}$/.test(punctuation)) return token.replaceAll('.', '․');
    return { '.': '․', ',': '‚', '。': '﹒', '，': '﹐' }[punctuation];
  });
}
export function restoreProtectedPunctuation(text) {
  return String(text).replaceAll('\u2060', '').replace(/[․‚﹒﹐]/g, char => ({ '․': '.', '‚': ',', '﹒': '。', '﹐': '，' })[char]);
}

export function createPunctuationClipboard({ clipboard, schedule = setInterval, cancel = clearInterval, retryDelay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let enabled = false, mode = 'compatible', timer, owned = null, lastSeen = null, error = '', epoch = 0, writing = null, polling = false;
  let serial = Promise.resolve();
  // Electron 44 clipboard reads AND writes return Promises. Serialize writes,
  // polling and restoration so a delayed old operation cannot overwrite a new copy.
  const enqueue = work => { const result = serial.then(work); serial = result.catch(() => {}); return result; };
  const status = () => ({ punctuationMode: mode, clipboardProtected: enabled && mode === 'compatible' && !error, clipboardError: error });
  const canonical = text => String(text).replace(/\r\n?/g, '\n');
  const readText = async () => { const text = await clipboard.readText(); if (typeof text !== 'string') throw new Error('无法读取剪贴板文本。'); return canonical(text); };
  const nonTextCopy = async () => {
    // Modern Electron exposes ClipboardItem.types; earlier versions expose formats.
    const formats = clipboard.availableFormats ? await clipboard.availableFormats() : clipboard.read ? (await clipboard.read()).flatMap(item => item.types || []) : [];
    return formats.some(format => /image|file|uri-list|hdrop/i.test(format));
  };
  const check = operation => { if (operation !== epoch) throw Object.assign(new Error('复制设置已变化，请重新复制台词。'), { superseded: true }); };
  async function writeVerified(original, output, operation, expected) {
    const windowsText = canonical(output).replace(/\n/g, '\r\n');
    let observed;
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        check(operation);
        try {
          const foreignFormat = (attempt > 0 || expected !== undefined) && await nonTextCopy();
          const current = await readText();
          check(operation);
          if (foreignFormat || (attempt === 0 && expected !== undefined && current !== expected) || (attempt && observed !== undefined && current !== observed && current !== canonical(output))) throw Object.assign(new Error('剪贴板已被其他复制操作更新，请重新点击复制到剪映。'), { superseded: true });
          await clipboard.writeText(windowsText);
          check(operation);
          observed = await readText();
          check(operation);
          if (observed === canonical(output)) {
            lastSeen = observed; error = '';
            owned = canonical(output) !== canonical(original) ? { original, protected: observed } : null;
            return { ...status(), copyVerified: true, copiedCharacters: [...canonical(original)].length, copiedLines: canonical(original).split('\n').filter(line => line.trim()).length };
          }
        } catch (failure) { if (failure.superseded) throw failure; }
        if (attempt < 5) await retryDelay(30);
      }
      throw new Error('剪贴板完整性校验未通过，未确认复制成功。请稍后重新点击复制到剪映。');
    } catch (failure) {
      if (operation === epoch) { error = failure.message; lastSeen = null; }
      throw failure;
    }
  }
  async function restoreOwned(operation) {
    if (owned && !await nonTextCopy() && await readText() === owned.protected) {
      check(operation);
      await clipboard.writeText(canonical(owned.original).replace(/\n/g, '\r\n'));
    }
    check(operation);
    owned = null; lastSeen = null;
  }
  function poll() {
    if (writing !== null || polling || !enabled || mode !== 'compatible') return Promise.resolve();
    polling = true;
    const operation = epoch;
    return enqueue(async () => { try {
      check(operation);
      // Do not replace images or Explorer file copies with plain text.
      if (await nonTextCopy()) return;
      const text = await readText();
      check(operation);
      if (text === lastSeen) return;
      lastSeen = text; owned = null;
      if (!text || text.length > 120000) return;
      const protectedText = protectPunctuation(text);
      if (protectedText !== text) {
        await writeVerified(restoreProtectedPunctuation(text), protectedText, operation, text);
      } else error = '';
    } catch (failure) { if (operation === epoch) error = failure.message || '剪贴板暂时被占用，请重新复制台词。'; }
    finally { polling = false; } });
  }
  async function configure(nextEnabled, nextMode = mode) {
    if (typeof nextEnabled !== 'boolean' || !['standard', 'compatible'].includes(nextMode)) throw new Error('无效的标点保护设置。');
    if (nextEnabled === enabled && nextMode === mode) return status();
    if (timer != null) cancel(timer);
    timer = null;
    const operation = ++epoch;
    enabled = nextEnabled; mode = nextMode;
    if (!nextEnabled || nextMode !== 'compatible') {
      await enqueue(async () => { try { check(operation); await restoreOwned(operation); error = ''; } catch (failure) { if (operation === epoch) error = failure.message; } });
    }
    if (operation === epoch && enabled && mode === 'compatible') { await poll(); if (operation === epoch) { timer = schedule(poll, 100); timer?.unref?.(); } }
    return status();
  }
  function copyVerified(original, output) {
    const operation = ++epoch;
    writing = operation;
    return enqueue(() => writeVerified(original, output, operation)).finally(() => { if (writing === operation) writing = null; });
  }
  return {
    status, configure,
    async copyPlain(text) {
      if (typeof text !== 'string' || text.length > 1000000 || text.includes('\0')) throw new Error('复制内容过长或格式无效。');
      // Explicit non-subtitle copies must remain valid JSON and retain original punctuation.
      // writeVerified records lastSeen so the compatibility poll will leave this copy intact.
      return copyVerified(text, text);
    },
    async copy(text, options = {}) {
      if (typeof text !== 'string' || text.length > 120000) throw new Error('字幕台词过长或格式无效。');
      if (!options || typeof options !== 'object' || (options.protect !== undefined && typeof options.protect !== 'boolean')) throw new Error('无效的单次字幕保护设置。');
      // CF_UNICODETEXT terminates at NUL. Remove that nonprinting artifact before writing.
      const original = canonical(normalizeSubtitlePunctuation(text.replaceAll('\0', '')));
      const protect = options.protect ?? (enabled && mode === 'compatible');
      const output = protect ? protectPunctuation(original) : original;
      return { ...await copyVerified(original, output), clipboardProtected: protect };
    },
    dispose() { return configure(false); },
  };
}
