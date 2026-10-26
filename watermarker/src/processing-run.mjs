// One owner per batch. Cancellation rejects waits and disposes only its own engines.
export function createProcessingRun() {
  const controller = new AbortController();
  const cleanups = new Set();
  let disposed = false;
  const check = () => { if (controller.signal.aborted) throw controller.signal.reason; };
  function release() {
    disposed = true;
    for (const cleanup of [...cleanups].reverse()) { try { cleanup(); } catch { /* Continue releasing other resources. */ } }
    cleanups.clear();
  }
  return {
    signal: controller.signal, check,
    own(cleanup) {
      if (disposed) { cleanup(); return () => {}; }
      cleanups.add(cleanup); return () => cleanups.delete(cleanup);
    },
    cancel() {
      if (!controller.signal.aborted) controller.abort(new DOMException('用户已中断处理', 'AbortError'));
      release();
    },
    dispose: release,
    wait(promise) {
      return new Promise((resolve, reject) => {
        const abort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(value => {
          controller.signal.removeEventListener('abort', abort);
          if (controller.signal.aborted) reject(controller.signal.reason); else resolve(value);
        }, error => { controller.signal.removeEventListener('abort', abort); reject(error); });
        if (controller.signal.aborted) abort();
      });
    },
  };
}
