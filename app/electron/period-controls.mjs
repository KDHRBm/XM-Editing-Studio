// Workspace and batch page have independent switches, sharing one native engine.
export function createPeriodControls({ command, guard, checkUpstreamStatus, shutdown }) {
  let workspace = false, batch = false, mode = 'compatible', serial = Promise.resolve();
  const enqueue = work => { const next = serial.then(work); serial = next.catch(() => {}); return next; };
  const view = state => ({ ...state, ...guard?.status(), nativeEnabled: !!state.enabled, enabled: workspace, batchEnabled: batch });
  const set = (owner, enabled, nextMode = mode) => enqueue(async () => {
    if (typeof enabled !== 'boolean' || !['standard','compatible'].includes(nextMode)) throw new Error('无效的标点开关状态。');
    const nextWorkspace = owner === 'workspace' ? enabled : workspace;
    const nextBatch = owner === 'batch' ? enabled : batch;
    if (nextWorkspace || nextBatch) await checkUpstreamStatus();
    const state = await command(nextWorkspace || nextBatch ? 'enable' : 'disable');
    workspace = nextWorkspace; batch = nextBatch; mode = nextMode;
    await guard?.configure(workspace, mode);
    return view(state);
  });
  return {
    status: () => enqueue(async () => view(await command('status'))),
    probe: () => enqueue(async () => view(await command('probe'))),
    setEnabled: (enabled, nextMode = 'compatible') => set('workspace', enabled, nextMode),
    setBatchEnabled: enabled => set('batch', enabled),
    async copy(text, options) {
      if (!guard) throw new Error('剪贴板不可用。');
      let state, warning = '';
      if (options?.protect === true) {
        try { state = await set('batch', true); }
        catch (error) { warning = `剪映标点组件未启用：${error.message}；已使用剪贴板兼容保护。`; }
      }
      const result = await guard.copy(text, options);
      if (state && state.engine !== 'active') warning = `已启用标点保留并保护复制文本；${state.engine === 'offline' ? '请打开剪映草稿后再粘贴匹配。' : '请在剪映草稿中重新粘贴并匹配，当前剪映原生规则尚未确认生效。'}`;
      return { ...result, ...(state ? { nativeEngine: state.engine } : {}), warning };
    },
    copyPlain: text => guard.copyPlain(text),
    async dispose() { await serial; await guard?.dispose(); await shutdown(); },
  };
}
