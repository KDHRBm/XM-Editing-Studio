// Workspace and batch page have independent switches, sharing one native engine.
export function createPeriodControls({ command, guard, checkUpstreamStatus, shutdown }) {
  let workspace = false, batch = false, mode = 'compatible', serial = Promise.resolve();
  let nativeState, batchActivation = null, activationError = '';
  const enqueue = work => { const next = serial.then(work); serial = next.catch(() => {}); return next; };
  const view = state => ({ ...state, ...guard?.status(), nativeEnabled: !!state.enabled, enabled: workspace, batchEnabled: batch });
  const set = (owner, enabled, nextMode = mode) => enqueue(async () => {
    if (typeof enabled !== 'boolean' || !['standard','compatible'].includes(nextMode)) throw new Error('无效的标点开关状态。');
    const nextWorkspace = owner === 'workspace' ? enabled : workspace;
    const nextBatch = owner === 'batch' ? enabled : batch;
    if (nextWorkspace || nextBatch) await checkUpstreamStatus();
    const state = await command(nextWorkspace || nextBatch ? 'enable' : 'disable');
    nativeState = state;
    workspace = nextWorkspace; batch = nextBatch; mode = nextMode;
    // The batch switch uses per-copy protection, not the workspace clipboard watcher.
    // A delayed native response must not reconfigure or restore a newer explicit copy.
    if (owner === 'workspace') await guard?.configure(workspace, mode);
    return view(state);
  });
  const enableBatch = () => {
    if (batchActivation) return batchActivation;
    activationError = '';
    batchActivation = set('batch', true).catch(error => { activationError = error.message; throw error; }).finally(() => { batchActivation = null; });
    return batchActivation;
  };
  return {
    status: () => enqueue(async () => view(nativeState = await command('status'))),
    probe: () => enqueue(async () => view(nativeState = await command('probe'))),
    setEnabled: (enabled, nextMode = 'compatible') => set('workspace', enabled, nextMode),
    setBatchEnabled: enabled => enabled === true ? enableBatch() : set('batch', enabled),
    async copy(text, options) {
      if (!guard) throw new Error('剪贴板不可用。');
      // Native scanning can take seconds. The explicit copy must not wait for it,
      // or for queued status/probe commands; protected text works independently.
      if (options?.protect === true && !batch) void enableBatch().catch(() => {});
      const result = await guard.copy(text, options);
      const state = options?.protect === true ? nativeState : null;
      let warning = '';
      if (options?.protect === true && activationError) warning = `剪映标点组件未启用：${activationError}；已使用剪贴板兼容保护。`;
      else if (options?.protect === true && batchActivation) warning = '标点组件正在后台准备，复制文本已完成兼容保护。';
      else if (state && state.engine !== 'active') warning = `已启用标点保留并保护复制文本；${state.engine === 'offline' ? '请打开剪映草稿后再粘贴匹配。' : '请在剪映草稿中重新粘贴并匹配，当前剪映原生规则尚未确认生效。'}`;
      return { ...result, ...(state ? { nativeEngine: state.engine } : {}), warning };
    },
    copyPlain: text => guard.copyPlain(text),
    async dispose() { await serial; await guard?.dispose(); await shutdown(); },
  };
}
