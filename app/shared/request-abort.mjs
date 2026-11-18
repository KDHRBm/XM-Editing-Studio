// WebView2 installations do not all expose AbortSignal.timeout/any/throwIfAborted.
// Keep request deadlines scoped so completed requests leave no timers/listeners.
const reasons = new WeakMap();

export function abortReason(signal) {
  return signal?.reason ?? reasons.get(signal) ?? new DOMException('请求已中断。', 'AbortError');
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

export function createAbortScope({ timeoutMs, signals = [] } = {}) {
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) {
    throw new RangeError('请求超时时间无效。');
  }
  const controller = new AbortController();
  const cleanups = [];
  let timer;
  const dispose = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
  const abort = reason => {
    if (controller.signal.aborted) return;
    reasons.set(controller.signal, reason);
    dispose();
    controller.abort(reason);
  };
  for (const signal of new Set(signals.filter(Boolean))) {
    if (signal.aborted) { abort(abortReason(signal)); break; }
    const listener = () => abort(abortReason(signal));
    signal.addEventListener('abort', listener, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', listener));
  }
  if (!controller.signal.aborted && timeoutMs !== undefined) {
    timer = setTimeout(() => abort(new DOMException('请求超时，请稍后重试。', 'TimeoutError')), timeoutMs);
    timer?.unref?.();
  }
  return { signal: controller.signal, dispose };
}

export async function withAbortScope(options, operation) {
  const scope = createAbortScope(options);
  try {
    throwIfAborted(scope.signal);
    const value = await operation(scope.signal);
    throwIfAborted(scope.signal);
    return value;
  } finally { scope.dispose(); }
}
