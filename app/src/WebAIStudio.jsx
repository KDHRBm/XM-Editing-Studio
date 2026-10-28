import { WEB_AI_PROVIDERS, clipWebAISlot } from '../shared/web-ai.mjs';
import { useScriptProjects } from './ScriptProjects.jsx';

export function WebAIStudio({ active, onNavigate }) {
  const [manualProvider, setProvider] = i.useState(() => { try { return WEB_AI_PROVIDERS.some(p => p.id === localStorage.getItem('xm.web-ai.provider')) ? localStorage.getItem('xm.web-ai.provider') : 'deepseek'; } catch { return 'deepseek'; } });
  const [task, setTask] = i.useState(null), [opened, setOpened] = i.useState(''), [manualReply, setManualReply] = i.useState('');
  const taskRef = i.useRef(null);
  const provider = task?.provider || opened || manualProvider;
  const visible = active || !!task || !!opened;
  const [status, setStatus] = i.useState(null);
  const [error, setError] = i.useState('');
  const [notice, setNotice] = i.useState('');
  const projects = useScriptProjects();
  const slot = i.useRef(null);
  const api = globalThis.blackObsidian;
  const ready = typeof api?.layoutWebAI === 'function' && typeof api?.webAIAction === 'function';
  const current = WEB_AI_PROVIDERS.find(item => item.id === provider);
  const changeProvider = value => { setProvider(value); if (opened) setOpened(value); setStatus(null); setError(''); try { localStorage.setItem('xm.web-ai.provider', value); } catch { /* selection works for this session */ } };
  i.useEffect(() => {
    if (!ready) return;
    if (!visible) { void api.layoutWebAI({ visible: false }).catch(() => {}); return; }
    let live = true, frame = 0, last = '', polling = false;
    setStatus(null); setError(''); setNotice('');
    const sync = () => {
      frame = 0;
      if (!live || !slot.current) return;
      const rect = slot.current.getBoundingClientRect();
      const rail = document.querySelector('.bos-quickrail[data-expanded=true] .bos-rail-inner')?.getBoundingClientRect();
      const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const bounds = clipWebAISlot(rect, viewport, slot.current.closest('.main-scroll')?.getBoundingClientRect(), rail?.width || 0);
      const modal = [...document.querySelectorAll('[role=dialog],.modal-backdrop')].some(node => node.getClientRects().length && !node.closest('[hidden],.bos-web-ai'));
      const input = { provider, visible: !modal && bounds.width > 100 && bounds.height > 80, bounds };
      const signature = JSON.stringify(input);
      if (signature === last) return;
      last = signature;
      void api.layoutWebAI(input).then(value => { if (live && value) { setStatus(value); setError(''); } }).catch(err => { if (live) { last = ''; setError(err.message); } });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const resize = new ResizeObserver(schedule); resize.observe(slot.current);
    const mutation = new MutationObserver(schedule); mutation.observe(document.body, { attributes: true, subtree: true, childList: true, attributeFilter: ['data-expanded', 'hidden', 'open', 'class', 'style'] });
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
    const poll = setInterval(() => { if (live) { schedule(); if (!polling) { polling = true; void api.webAIAction(provider, 'page-status').then(value => { if (live) { setStatus(value); setError(''); } }).catch(err => { if (live) setError(err.message); }).finally(() => { polling = false; }); } } }, 1500);
    schedule();
    return () => { live = false; cancelAnimationFrame(frame); clearInterval(poll); resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); void api.layoutWebAI({ visible: false }).catch(() => {}); };
  }, [visible, provider, ready]);
  i.useEffect(() => {
    if (!api?.onWebAnalysisTask) return;
    let live = true, receivedEvent = false;
    const receive = value => { if (live) { setTask(value); if (taskRef.current?.token !== value?.token) { setManualReply(''); setError(''); } taskRef.current = value; if (value) setOpened(''); } };
    const unsubscribe = api.onWebAnalysisTask(value => { receivedEvent = true; receive(value); });
    void api.getWebAnalysisTask().then(value => { if (!receivedEvent) receive(value); }).catch(() => {});
    const open = event => { if (WEB_AI_PROVIDERS.some(p => p.id === event.detail)) { setOpened(event.detail); setProvider(event.detail); } };
    window.addEventListener('xm-open-web-ai', open);
    return () => { live = false; unsubscribe(); window.removeEventListener('xm-open-web-ai', open); };
  }, []);
  const taskAction = async name => { try { setError(''); await api.webAnalysisAction(task.id, name, manualReply); if (name === 'copy') setNotice('任务已完整复制。请在网页粘贴并发送。'); } catch (err) { setError(err.message); } };
  const action = async name => { setError(''); try { const value = await api.webAIAction(provider, name); if (!value.external) setStatus(value); } catch (err) { setError(err.message); } };
  const copyTask = async purpose => {
    setError(''); setNotice('');
    try { if (!api?.copyWebAITask) throw new Error('请更新桌面程序后使用剧本复制。'); await api.copyWebAITask(projects.project.draft, purpose); setNotice('已完整复制当前剧本和任务指令，保留原始标点。请粘贴到下方网页，确认后发送。'); }
    catch (err) { setError(err.message || '复制失败，请重试。'); }
  };
  return <section className={`bos-script bos-web-ai${task || opened ? ' bos-web-ai-overlay' : ''}`} hidden={!visible} aria-label="国内 AI 官方网页版">
    {(task || opened) && <div className="bos-web-ai-task-heading"><strong>{task ? `${current.name} · ${task.stage}` : `${current.name} · 官方网页登录`}</strong><button type="button" onClick={() => task ? taskAction('cancel') : setOpened('')}>{task?.kind === 'draft-scan' ? '中断扫描 · F10' : task ? '中断分析' : '返回工作空间'}</button></div>}
    {task && <div className="bos-web-ai-task"><p role="status">{task.message}</p><div className="bos-script-actions"><button type="button" onClick={() => taskAction('copy')}>复制当前任务</button><small>网页回答会自动读取并接回原任务，无需 API 配置。</small></div><details><summary>网页无法自动读取时，粘贴回答继续</summary><textarea aria-label="网页分析结果" value={manualReply} onChange={event => setManualReply(event.target.value)} rows={3} placeholder="粘贴网页返回的完整 JSON 回答" /><button type="button" disabled={!manualReply.trim()} onClick={() => taskAction('import')}>导入结果并继续</button></details></div>}
    <div className="bos-web-ai-toolbar"><div className="bos-source-choice" role="group" aria-label="选择国内 AI">{WEB_AI_PROVIDERS.map(item => <button type="button" key={item.id} disabled={!!task} aria-pressed={provider === item.id} onClick={() => changeProvider(item.id)}>{item.name}</button>)}</div><div className="bos-script-actions"><button type="button" disabled={!ready} onClick={() => action('login')}>登录账号</button><button type="button" disabled={!ready || !!task} onClick={() => action('home')}>返回官网首页</button><button type="button" disabled={!ready} onClick={() => action('reload')}>刷新网页</button><button type="button" disabled={!ready} onClick={() => action('external')}>系统浏览器打开 ↗</button></div></div>
    <div className="bos-web-ai-note"><strong>{current.name} 官方网页版 · 无需 API 密钥</strong><p>在下方登录你自己的账号即可聊天。{current.description}可用模型、免费额度和限制以官网为准，登录状态分别保存在本机。</p><small>{status?.loading ? '正在加载网页… · ' : '当前网址：'}{status?.url || current.url}</small></div>
    {!task && <details className="bos-web-ai-script"><summary>使用工作空间的当前剧本</summary><p>{projects.project.draft.script.trim() ? `当前剧本 ${projects.project.draft.script.length} 字符 · ${projects.project.draft.segmented ? '按情节分段' : '整篇分析'}` : '先到工作空间粘贴剧本，再复制分析任务。'}可在工作空间选择本网页模型直接分析，也可自行粘贴任务。生成音乐仍使用原有 Suno 服务。</p><div className="bos-script-actions"><button type="button" disabled={!projects.project.draft.script.trim()} onClick={() => copyTask('keywords')}>复制剧本关键词任务</button><button type="button" disabled={!projects.project.draft.script.trim()} onClick={() => copyTask('suno')}>复制 Suno 提示词任务</button><button type="button" onClick={() => onNavigate('workspace')}>前往工作空间</button><button type="button" onClick={() => onNavigate('music')}>前往音乐页</button></div></details>}
    {notice && <p className="bos-script-message" role="status">{notice}</p>}
    {(error || status?.error) && <p className="bos-script-warning" role="alert">{error || status.error}</p>}
    {status?.pageNotice && <p className="bos-script-warning" role="status">{status.pageNotice}</p>}
    {!ready && <p className="bos-script-warning">请更新桌面程序后使用内嵌网页。也可通过官网访问：<a href={current.url} target="_blank" rel="noreferrer">{current.name}</a></p>}
    <div ref={slot} className="bos-web-ai-slot" aria-label={`${current.name} 网页显示区域`}><span>正在准备 {current.name} 官方网页…</span></div>
  </section>;
}
