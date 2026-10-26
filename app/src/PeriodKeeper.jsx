import { normalizeSubtitlePunctuation } from '../shared/period-text.mjs';
import { periodKeeperStatusText } from '../shared/subtitle-punctuation.mjs';
import { usePanelCollapsed } from './PanelState.jsx';

export async function copySubtitleText(text) {
  const api = globalThis.blackObsidian;
  if (api?.copySubtitleText) return api.copySubtitleText(text);
  await navigator.clipboard.writeText(normalizeSubtitlePunctuation(text));
  return { punctuationMode: 'standard', clipboardProtected: false };
}

export function PeriodKeeper({ text }) {
  const [state, setState] = i.useState(null);
  const [busy, setBusy] = i.useState(false);
  const [error, setError] = i.useState('');
  const [notice, setNotice] = i.useState('');
  const [collapsed, toggleCollapsed] = usePanelCollapsed('period-keeper');
  const api = globalThis.blackObsidian;
  const available = typeof api?.getPeriodKeeperStatus === 'function';
  const latestText = i.useRef(text); latestText.current = text;
  i.useEffect(() => {
    if (!available) return;
    let active = true, timer;
    const refresh = async () => {
      try { const value = await api.getPeriodKeeperStatus(); if (active) setState(value); }
      catch (err) { if (active) setError(err.message); }
      if (active) timer = setTimeout(refresh, 4000);
    };
    void refresh(); return () => { active = false; clearTimeout(timer); };
  }, []);
  const perform = async operation => { setBusy(true); setError(''); setNotice(''); try { await operation(); } catch (err) { setError(err.message || '操作失败。'); } finally { setBusy(false); } };
  const copy = async () => {
    const result = await copySubtitleText(latestText.current);
    setNotice(result.clipboardProtected ? `已完整复制 ${result.copiedLines} 行台词，逗号和句号已按原工具保护，请粘贴到剪映。` : '已复制完整台词；保留功能尚未开启，使用标准英文标点。');
  };
  return <section className="bos-period-keeper" aria-labelledby="bos-period-title">
    <header className="bos-period-heading"><h4 id="bos-period-title">剪映 · 标点保留</h4><button type="button" className="bos-panel-toggle" aria-expanded={!collapsed} aria-controls="bos-period-body" onClick={toggleCollapsed}>{collapsed ? '展开标点工具' : '收起标点工具'} <span aria-hidden="true">{collapsed ? '⌄' : '⌃'}</span></button></header>
    <div id="bos-period-body" hidden={collapsed}>
      <div className="bos-period-status" role="status"><strong>{state ? periodKeeperStatusText(state) : available ? '正在检测剪映…' : '请在桌面程序中启用标点保留'}</strong><small>{state?.clipboardProtected ? '原工具兼容保护已开启 · 完整复制后校验' : '开启保留后，按原工具方式保护逗号和句号'}</small></div>
      <div className="bos-period-actions">
        <button type="button" role="switch" aria-label="剪映标点保留" aria-checked={!!state?.enabled} disabled={!available || !state || busy} onClick={() => perform(async () => { setState(await api.setPeriodKeeperEnabled(!state.enabled, 'compatible')); })}>{state?.enabled ? '关闭保留' : '开启保留'}</button>
        <button type="button" className="bos-script-primary" disabled={!text.trim() || busy} onClick={() => perform(copy)}>复制到剪映</button>

      </div>
      {(error || state?.error || state?.clipboardError) && <p className="bos-script-warning" role="alert">{error || state.error || state.clipboardError}</p>}
      <p className="bos-period-hint">先打开剪映草稿，点击「开启保留」，再点击「复制到剪映」并进行文稿匹配。按原工具方式将剪贴板中的 , . 保护为外观相近的 ‚ ․，省略号保留 ...。台词显示与 TXT 保持标准英文字符，复制成功会显示完整行数。</p>
      {notice && <p className="bos-script-message" role="status">{notice}</p>}
      <details><summary>使用方法与项目来源</summary><p>兼容保护期间会在本机检查新复制的文本，不记录或上传剪贴板内容。软件无法自动判断剪映最终字幕是否丢标点，请在匹配后检查。切换模式不会改动已生成的字幕，需要重新粘贴并匹配。</p><p>关闭保留或退出 XM剪辑台，会停止保护并恢复本次修改。若剪映规则恢复失败，重启剪映即可。功能根据 <a href="https://github.com/Kirota233/JianYing-Period-Keeper" target="_blank" rel="noreferrer">Kirota233 / JianYing-Period-Keeper</a> 集成。</p><button type="button" disabled={!available || busy} onClick={() => perform(async () => setState(await api.probePeriodKeeper()))}>检测兼容性</button></details>
    </div>
  </section>;
}
