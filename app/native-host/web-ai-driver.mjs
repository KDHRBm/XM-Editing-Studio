import { webAIPageScript } from '../electron/web-ai-dom.mjs';
import { webAIProvider } from '../shared/web-ai.mjs';

export async function runNativeWebAI(invoke, provider, input, signal) {
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  const cancel = () => { void invoke('web-ai-cancel', { requestId }).catch(() => {}); };
  let abort;
  try {
    const interrupted = new Promise((_, reject) => {
      abort = () => reject(signal.reason || new DOMException('网页操作已中断。', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
    });
    const result = await Promise.race([
      invoke('web-ai-run', { requestId, provider, script: webAIPageScript({ ...input, host: webAIProvider(provider).host }) }, 20000),
      interrupted,
    ]);
    signal?.throwIfAborted();
    return result;
  } catch (error) { cancel(); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}
