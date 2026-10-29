import { MusicUsageHistory } from './MusicUsageHistory.jsx';
import { SegmentRecommendations } from './SegmentRecommendations.jsx';
import { MusicDragButton } from './MusicDragButton.jsx';
import { Pagination, usePages } from './Pagination.jsx';
import { usePanelCollapsed } from './PanelState.jsx';
import { CUSTOM_KEYWORDS_LIMIT, parseCustomKeywords, searchMusicTitles, sameLibraryRequest } from '../shared/library-search.mjs';
import { excludeUsedMusic, shuffleMusicResults, MUSIC_USAGE_LIMIT } from '../shared/library-usage.mjs';
import { musicUsage } from './MusicUsage.mjs';
import { analysisName, analysisReady, webAnalyzer } from '../shared/script-analyzers.mjs';
import { requestScriptAnalysis } from './AnalysisRequest.mjs';
const RESULT_KEY = 'black-obsidian.library-match.v1';
const emptyCatalog = { directories: [], tracks: [], revision: '', warning: '' };
let matchState = { busy: false, record: null, error: '' };
let activeRequest = null;
try { matchState.record = JSON.parse(localStorage.getItem(RESULT_KEY)); } catch { /* no previous analysis */ }
const subscribers = new Set();
const subscribe = listener => { subscribers.add(listener); return () => subscribers.delete(listener); };
const snapshot = () => matchState;
const publish = values => { matchState = { ...matchState, ...values }; subscribers.forEach(listener => listener()); };

export function clearCurrentLibraryMatch(projectId, draft) {
  const cancel = activeRequest?.projectId === projectId;
  if (cancel) { activeRequest.controller.abort(); activeRequest = null; }
  const sameRecord = sameLibraryRequest(matchState.record, draft);
  if (sameRecord) { try { localStorage.removeItem(RESULT_KEY); } catch { /* current project still resets independently */ } }
  publish({ ...(cancel ? { busy: false } : {}), ...(sameRecord ? { record: null } : {}), error: '' });
}

export function MusicLibrary({ input, projectId, savedRecommendation, onAnalysis, onChange, lines, gemini, generationAnalyzer = gemini, settings, onUse, isSelected = () => false, onGenerate, segmentJob, onViewJob }) {
  const analyzerName = analysisName(gemini);
  const [catalog, setCatalog] = i.useState(emptyCatalog);
  const [scanning, setScanning] = i.useState(false);
  const [dragging, setDragging] = i.useState(false);
  const scanPending = i.useRef(false);
  const [error, setError] = i.useState('');
  const [notice, setNotice] = i.useState('');
  const [collapsed, toggleCollapsed] = usePanelCollapsed('local-music');
  const [analysisCollapsed, toggleAnalysisCollapsed] = usePanelCollapsed('music-analysis');
  const [analysisError, setAnalysisError] = i.useState('');
  const [analysisNotice, setAnalysisNotice] = i.useState('');
  const match = i.useSyncExternalStore(subscribe, snapshot);
  const usage = i.useSyncExternalStore(musicUsage.subscribe, musicUsage.snapshot);
  const [randomOrder, setRandomOrder] = i.useState(true);
  const [shuffleRevision, setShuffleRevision] = i.useState(0);
  const eligibleTracks = i.useMemo(() => excludeUsedMusic(catalog.tracks, usage.history), [catalog.tracks, usage.history]);
  const api = globalThis.blackObsidian;
  const ready = typeof api?.getMusicLibrary === 'function';
  const catalogPages = usePages(catalog.tracks);
  const keywordText = input.customKeywords || '';
  const search = i.useMemo(() => {
    try {
      const keywords = parseCustomKeywords(keywordText);
      const all = searchMusicTitles(catalog.tracks, keywords);
      // Keep this search's cards available for undo. Apply recent-use exclusions
      // when the user next changes the search, refreshes, or requests a new batch.
      const eligible = new Set(excludeUsedMusic(catalog.tracks, musicUsage.snapshot().history).map(track => track.id));
      const results = all.filter(item => eligible.has(item.track.id));
      return { keywords, results, excluded: all.length - results.length, error: '' };
    } catch (err) { return { keywords: [], results: [], excluded: 0, error: err.message }; }
  }, [keywordText, catalog.tracks, catalog.revision, projectId, randomOrder, shuffleRevision]);
  const orderedResults = i.useMemo(() => randomOrder ? shuffleMusicResults(search.results) : search.results, [search.results, randomOrder, shuffleRevision]);
  const searchPages = usePages(orderedResults);
  i.useEffect(() => { searchPages.setPage(1); }, [keywordText, catalog.revision, randomOrder, shuffleRevision]);
  const changeKeywords = value => { onChange({ customKeywords: value }); setError(''); setNotice(''); };
  const addKeyword = word => {
    try {
      const words = parseCustomKeywords([...search.keywords, word].join('，'));
      const value = words.join('，');
      parseCustomKeywords(value);
      changeKeywords(value);
      setAnalysisError(''); setAnalysisNotice(`已将「${word}」加入本地检索关键词。`);
    } catch (err) { setAnalysisError(err.message); }
  };
  i.useEffect(() => {
    let active = true;
    if (ready) api.getMusicLibrary().then(value => { if (active) setCatalog(value); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  const changeCatalog = async operation => {
    if (!ready) { setError('连接本地盘需要使用更新后的桌面程序。'); return; }
    if (scanPending.current) return;
    scanPending.current = true;
    setScanning(true); setError('');
    try { setCatalog(await operation()); setNotice('音乐索引已更新。新增或重命名音乐后，可重新分析匹配。'); }
    catch (err) { setError(err.message || '无法读取音乐库。'); }
    finally { scanPending.current = false; setScanning(false); }
  };
  const dropFolders = event => {
    if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
    event.preventDefault(); event.stopPropagation(); setDragging(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (!api?.connectDroppedMusicFolders) { setError('请使用新版桌面程序拖入文件夹，也可以点击“连接音乐文件夹”。'); return; }
    if (collapsed) toggleCollapsed();
    void changeCatalog(() => api.connectDroppedMusicFolders(files));
  };
  const analyze = async () => {
    if (matchState.busy) return;
    if (!input.script.trim()) { setAnalysisError('请先粘贴完整剧本。'); return; }
    if (search.error) { setAnalysisError(search.error); return; }
    if (!analysisReady(gemini)) { setAnalysisError('请选择可用的剧本分析模型；DeepSeek、豆包网页版无需 API 配置。'); return; }
    setAnalysisError(''); setAnalysisNotice(''); publish({ busy: true, error: '', analyzer: analyzerName });
    const request = { projectId, controller: new AbortController() };
    activeRequest = request;
    const captured = { script: input.script, title: input.title, hint: input.hint, customKeywords: keywordText, segmented: !!input.segmented, segmentCount: Number(input.segmentCount || 3), analyzer: analyzerName, libraryGeminiKey: gemini.key || input.libraryGeminiKey || '' };
    try {
      const value = await requestScriptAnalysis('library-match', { ...captured, provider: gemini.provider, model: gemini.model, tracks: excludeUsedMusic(catalog.tracks, musicUsage.snapshot().history).map(({ id, title }) => ({ id, title })) }, webAnalyzer(gemini) ? request.controller.signal : AbortSignal.any([request.controller.signal, AbortSignal.timeout(730000)]));
      if (activeRequest !== request) return;
      if (value.segments) value.segments = value.segments.map(segment => ({ ...segment, matches: segment.matches.map(match => ({ ...match, title: catalog.tracks.find(track => track.id === match.id)?.title || match.id })) }));
      const record = { ...captured, revision: catalog.revision, value: { ...value, matches: (value.matches || []).map(m => ({ ...m, title: catalog.tracks.find(t => t.id === m.id)?.title || m.id })) } };
      let storageMessage = '';
      try { localStorage.setItem(RESULT_KEY, JSON.stringify(record)); } catch { storageMessage = '结果暂时无法保存，重启后可能需要重新分析。'; }
      onAnalysis(projectId, record);
      publish({ busy: false, record, error: storageMessage });
    } catch (err) { if (activeRequest === request) publish({ busy: false, error: request.controller.signal.aborted ? '分析已中断。' : err.message || `${analyzerName} 分析失败。` }); }
    finally { if (activeRequest === request) activeRequest = null; }
  };
  const records = [savedRecommendation, match.record];
  const record = records.find(r => sameLibraryRequest(r, input)) || records.find(r => r && r.script === input.script);
  const current = sameLibraryRequest(record, input);
  const result = record?.value || null;
  const available = result?.matches?.flatMap(m => { const track = catalog.tracks.find(t => t.id === m.id); return [{ ...m, available: !!track, track: track || { id: m.id, title: m.title || '历史音乐', relativePath: '音乐当前未连接，请重新连接原音乐库。' } }]; }) || [];
  const matchPages = usePages(available);
  i.useEffect(() => { catalogPages.setPage(1); }, [catalog.revision]);
  i.useEffect(() => { matchPages.setPage(1); }, [result]);
  const useAndRemember = async (...args) => {
    const selected = (await onUse(...args)) !== false;
    if (selected) musicUsage.remember(args[0]);
    else musicUsage.forget(args[0].id);
    return selected;
  };
  const markUsed = (track, source = 'library') => {
    const used = musicUsage.toggle(track);
    (source === 'analysis' ? setAnalysisNotice : setNotice)(used ? `已记录「${track.title}」，后续检索自动避开最近 ${MUSIC_USAGE_LIMIT} 首已使用音乐。` : `已取消「${track.title}」的使用标记，可再次参与检索和推荐。`);
  };
  const useTrack = async item => {
    try { setAnalysisError(''); const selected = await useAndRemember(item.track, result.analysis, item.reason, lines); setAnalysisNotice(selected ? `已选用「${item.track.title}」，可在下方任务区导出素材。` : `已取消选用「${item.track.title}」，已移除对应任务和使用标记。`); }
    catch (err) { setAnalysisError(err.message); }
  };
  const useSearchTrack = async item => {
    try {
      setError('');
      const reason = `手动检索，音乐标题命中：${item.keywords.join('、')}`.slice(0, 500);
      const selected = await useAndRemember(item.track, { summary: '按自定义关键词检索本地音乐，由用户试听后选用；未调用 AI 评估。', keywords: search.keywords }, reason, lines);
      setNotice(selected ? `已选用「${item.track.title}」，可在下方任务区导出素材。` : `已取消选用「${item.track.title}」，已移除对应任务和使用标记。`);
    } catch (err) { setError(err.message); }
  };
  return <><section className={`bos-library bos-script-panel${dragging ? ' bos-library-dragging' : ''}`} aria-labelledby="bos-library-title" aria-busy={scanning}
    onDragOver={event => { if (Array.from(event.dataTransfer.types || []).includes('Files')) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = scanning ? 'none' : 'copy'; setDragging(!scanning); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={dropFolders}>
    <div className="bos-library-heading"><div><span className="bos-script-eyebrow">YOUR MUSIC LIBRARY</span><h3 id="bos-library-title">本地音乐库</h3><p>管理音乐文件夹与检索标题。支持多个文件夹与子目录。</p></div><div className="bos-script-actions"><button type="button" disabled={scanning} onClick={() => changeCatalog(() => api.connectMusicLibrary())}>{scanning ? '正在扫描…' : '连接音乐文件夹'}</button><button type="button" disabled={scanning || !catalog.directories.length} onClick={() => changeCatalog(() => api.refreshMusicLibrary())}>刷新音乐库</button><button type="button" className="bos-panel-toggle" aria-expanded={!collapsed} aria-controls="bos-library-body" onClick={toggleCollapsed}>{collapsed ? '展开本地配乐' : '收起本地配乐'} <span aria-hidden="true">{collapsed ? '⌄' : '⌃'}</span></button></div></div>
    <div className="bos-library-drop-hint" role="status">{scanning ? '正在读取音乐文件夹，请稍候…' : dragging ? '松开即可连接文件夹并扫描音乐' : '拖入音乐文件夹即可自动识别，支持多个文件夹与子目录'}</div>
    <div id="bos-library-body" hidden={collapsed}>
    {error && <div className="bos-script-alert" role="alert">{error}</div>}
    {usage.error && <p className="bos-script-warning" role="alert">{usage.error}</p>}
    <div className="bos-library-folders">{catalog.directories.map(folder => <div key={folder.id}><div><strong>{folder.path}</strong><small>{folder.error || `${folder.count} 首音乐`}</small></div><button type="button" aria-label={`断开音乐文件夹 ${folder.path}`} disabled={scanning} onClick={() => changeCatalog(() => api.disconnectMusicLibrary(folder.id))}>断开</button></div>)}</div>
    {!catalog.directories.length && <p className="bos-library-empty">尚未连接音乐文件夹。以后将可用音乐放进该文件夹，刷新后即可参与匹配。</p>}
    {catalog.warning && <p className="bos-script-warning">{catalog.warning}</p>}
    {!!catalog.tracks.length && <details className="bos-library-index" open><summary>已收录 {catalog.tracks.length} 首音乐 · 标题索引</summary><ul aria-label="本页音乐标题">{catalogPages.visible.map(track => <li key={track.id}>{track.title}<small>{track.relativePath}</small><MusicDragButton libraryId={track.id} /></li>)}</ul><Pagination {...catalogPages} label="音乐库页码" /></details>}
    <div className="bos-library-search">
      <label htmlFor="bos-library-search-input"><span>自定义检索关键词 <small>{keywordText.length} / {CUSTOM_KEYWORDS_LIMIT}</small></span><textarea id="bos-library-search-input" rows={2} maxLength={CUSTOM_KEYWORDS_LIMIT} value={keywordText} onChange={event => changeKeywords(event.target.value)} aria-describedby="bos-library-search-help" aria-invalid={!!search.error} placeholder="例如：悬疑，悲伤，piano，orchestral drama" /></label>
      <div className="bos-library-search-tools"><small id="bos-library-search-help">用逗号、分号或换行分隔，最多 20 个词或短语。输入后即时检索标题，命中任意词即可；本地检索不调用 AI。</small><button type="button" disabled={!keywordText} onClick={() => changeKeywords('')}>清空关键词</button></div>
      {search.error && <p className="bos-script-warning" role="alert">{search.error}</p>}
      {!!search.keywords.length && <div className="bos-library-keywords" aria-label="自定义检索词">{search.keywords.map(word => <button type="button" key={word} aria-label={`移除关键词 ${word}`} onClick={() => changeKeywords(search.keywords.filter(item => item !== word).join('，'))}>{word} <span aria-hidden="true">×</span></button>)}</div>}
      {!!search.keywords.length && <details className="bos-library-search-results" open>
        <summary>本地标题检索 · {search.results.length} 首 · 可直接试听选用</summary>
        <div className="bos-library-random-tools"><div className="bos-script-actions" role="group" aria-label="检索结果排序"><button type="button" aria-pressed={randomOrder} onClick={() => { setRandomOrder(true); setShuffleRevision(value => value + 1); }} disabled={!search.results.length}>{randomOrder ? '随机换一批' : '随机排序'}</button><button type="button" aria-pressed={!randomOrder} onClick={() => setRandomOrder(false)} disabled={!search.results.length}>按匹配度</button></div><small>已避开最近使用中的 {search.excluded} 首匹配音乐 · 每页 5 首</small></div>
        {!search.results.length && <p className="bos-library-empty">{search.excluded ? '匹配的音乐都在最近使用记录中，已自动避开。可更换关键词或添加其他音乐。' : catalog.tracks.length ? `没有标题命中这些关键词。可尝试同义词、英文名称，或使用下方 ${analyzerName} 结合剧情匹配。` : '请先连接音乐文件夹。'}</p>}
        {searchPages.visible.map((item, index) => <article className="bos-library-match" key={item.track.id}><div className="bos-library-match-title"><span>{String((searchPages.page - 1) * 5 + index + 1).padStart(2, '0')}</span><div><h4>{item.track.title}</h4><small>{item.track.relativePath}</small></div><button type="button" aria-pressed={isSelected(item.track)} disabled={!isSelected(item.track) && (!input.script.trim() || scanning)} title={isSelected(item.track) ? '再次点击取消选用' : !input.script.trim() ? '粘贴剧本后可选用并导出素材' : '选用这首本地音乐'} onClick={() => useSearchTrack(item)}>{isSelected(item.track) ? '已选用 · 点击取消' : '选用此音乐'}</button></div><p>标题命中：{item.keywords.join(' · ')}</p><audio controls preload="none" src={`/local-music/${item.track.id}`} aria-label={`检索试听 ${item.track.title}`} /><div className="bos-library-use-tools"><MusicDragButton libraryId={item.track.id} /><button type="button" aria-pressed={usage.history.some(track => track.id === item.track.id)} title="再次点击可取消使用标记" onClick={() => markUsed(item.track)}>{usage.history.some(track => track.id === item.track.id) ? '已标记使用' : '标记已使用'}</button></div></article>)}
        {!!search.results.length && <Pagination {...searchPages} label="自定义检索结果页码" />}
      </details>}
    </div>
    {notice && <p role="status" className="bos-script-message">{notice}</p>}
    </div>
  </section>
  <MusicUsageHistory tracks={catalog.tracks} />
  <section className="bos-library bos-script-panel bos-music-analysis-panel" aria-labelledby="bos-music-analysis-title">
    <div className="bos-library-heading"><div><span className="bos-script-eyebrow">STORY SOUNDTRACK</span><h3 id="bos-music-analysis-title">分析配乐</h3><p>使用当前剧本与所选模型，提取关键词并推荐整篇或各情节的配乐。</p></div><div className="bos-script-actions"><span role="status">{match.busy ? `${analysisName(match.analyzer || analyzerName)} 正在分析…` : result ? '已有推荐' : '等待分析'}</span><button type="button" className="bos-panel-toggle" aria-expanded={!analysisCollapsed} aria-controls="bos-music-analysis-body" onClick={toggleAnalysisCollapsed}>{analysisCollapsed ? '展开分析配乐' : '收起分析配乐'} <span aria-hidden="true">{analysisCollapsed ? '⌄' : '⌃'}</span></button></div></div>
    <div id="bos-music-analysis-body" hidden={analysisCollapsed}>
    {settings}
    <div className="bos-music-analysis-context"><span>分析模型：{analyzerName}</span><span>{input.segmented ? `按情节分段 · 最多 ${input.segmentCount || 3} 段` : '整篇剧本配乐'}</span><span>可用音乐：{eligibleTracks.length} 首</span></div>
    <p className="bos-script-footnote bos-music-analysis-keywords">{search.keywords.length ? `当前检索词：${search.keywords.join(' · ')}` : '未设置检索词，将根据完整剧本分析匹配。'} 可在上方本地音乐库修改检索词。</p>
    {(analysisError || match.error || search.error) && <div className="bos-script-alert" role="alert">{analysisError || match.error || search.error}</div>}
    {usage.error && <p className="bos-script-warning" role="alert">{usage.error}</p>}
    <div className="bos-library-analyze"><button type="button" className="bos-script-primary" disabled={match.busy || scanning || !input.script.trim() || !!search.error} onClick={analyze}>{match.busy ? `${analysisName(match.analyzer || analyzerName)} 正在分析与匹配…` : input.segmented ? `${analyzerName} 分情节分析并推荐音乐` : search.keywords.length ? `${analyzerName} 结合自定义关键词匹配` : `${analyzerName} 识别剧本关键词并匹配`}</button>{match.busy && <button type="button" onClick={() => activeRequest?.controller.abort()}>中断分析</button>}<small>读取完整剧本、检索词及音乐标题；音频留在本机。{catalog.tracks.length ? '自动避开最近使用音乐，再将命中自定义词的候选送交评估。' : '未添加音乐时可先提取剧本关键词。'}</small></div>
    {!current && records.some(Boolean) && <p className="bos-script-footnote">{record ? `下方是上次条件下的推荐。点击 ${analyzerName} 重新匹配后可选用新的推荐；本地检索结果已即时更新。` : '剧本或检索条件已改变，重新分析即可获得当前剧本的匹配结果。'}</p>}
    {result && <div className="bos-library-analysis">
      <h4>剧本关键词</h4><p>{result.analysis.summary}</p><small>点击关键词可加入上方自定义检索。</small><div className="bos-library-keywords">{result.analysis.keywords.map(word => <button type="button" key={word} disabled={!!search.error || search.keywords.some(term => term.toLocaleLowerCase() === word.toLocaleLowerCase())} title={`加入检索：${word}`} onClick={() => addKeyword(word)}>{word} <span aria-hidden="true">＋</span></button>)}</div>
      {record.revision !== catalog.revision && <p className="bos-script-warning">音乐库已有更新；新增标题需要重新匹配。现存的推荐仍可试听和选用。</p>}
      <div className="bos-script-section-title"><h4>{result.segments ? "各情节音乐推荐" : "适合这份剧本的音乐"}</h4><small>检索 {result.total} 首 · {analysisName(record.analyzer)} 评估 {result.evaluated} 首候选</small></div>
      {!result.segments && result.noMatchReason && <p className="bos-script-footnote">{result.noMatchReason}</p>}
      {!result.segments && !available.length && <p className="bos-library-empty">{result.total ? '暂无适合的可用音乐。可以添加标题含场景、情绪或风格关键词的音乐后刷新重试，或切换到 Suno 生成配乐。' : '关键词已提取。连接音乐文件夹后，再次匹配即可列出候选。'}</p>}
      {result.segments && <SegmentRecommendations segments={result.segments} tracks={catalog.tracks} current={current} lines={lines} onUse={useAndRemember} isSelected={isSelected} onError={setAnalysisError} onGenerate={onGenerate} segmentJob={segmentJob} onViewJob={onViewJob} onMarkUsed={track => markUsed(track, 'analysis')} usedIds={usage.history.map(track => track.id)} analyzer={generationAnalyzer} />}
      {matchPages.visible.map((item, index) => <article className="bos-library-match" key={item.id}><div className="bos-library-match-title"><span>{String((matchPages.page - 1) * 5 + index + 1).padStart(2, '0')}</span><div><h4>{item.track.title}</h4><small>{item.track.relativePath}</small></div><button type="button" aria-pressed={isSelected(item.track)} title={isSelected(item.track) ? '再次点击取消选用' : '选用这首本地音乐'} disabled={!isSelected(item.track) && (!item.available || !current)} onClick={() => useTrack(item)}>{isSelected(item.track) ? '已选用 · 点击取消' : !item.available ? '需连接音乐库' : !current ? '请重新匹配' : '选用此音乐'}</button></div><p>{item.reason}</p><div className="bos-library-keywords">{item.keywords.map((word, idx) => <span key={`${word}-${idx}`}>{word}</span>)}</div>{item.available && <audio controls preload="none" src={`/local-music/${item.id}`} aria-label={`试听 ${item.track.title}`} />}{item.available && <div className="bos-library-use-tools"><MusicDragButton libraryId={item.id} /><button type="button" aria-pressed={usage.history.some(track => track.id === item.id)} title="再次点击可取消使用标记" onClick={() => markUsed(item.track, 'analysis')}>{usage.history.some(track => track.id === item.id) ? '已标记使用' : '标记已使用'}</button></div>}</article>)}
      {available.length > 5 && <Pagination {...matchPages} label="推荐音乐页码" />}
      <p className="bos-script-footnote">每个情节优先推荐 5–8 首，不足会补充评估并说明原因。推荐依据音乐标题语义，选用前可试听确认。音乐超过 80 首时，先用中英文关键词筛选最多 80 首候选交给 {analyzerName}；文件名越清晰，越容易匹配。</p>
    </div>}
    {analysisNotice && <p role="status" className="bos-script-message">{analysisNotice}</p>}
    </div>
  </section></>;
}
