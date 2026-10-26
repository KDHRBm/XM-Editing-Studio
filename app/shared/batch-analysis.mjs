import { SCRIPT_LIMIT, splitScript, segmentOptions } from './script-score.mjs';
import { extractChineseSubtitles } from './chinese-subtitles.mjs';

export const BATCH_TEXT_LIMIT = 1000000;
export const BATCH_TASK_LIMIT = 200;
export const BATCH_GROUP_CHARACTERS = 60000;
export const BATCH_GROUP_EPISODES = 12;
const fail = message => { throw new Error(message); };
const digits = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
export function episodeNumber(text) {
  if (/^\d+$/.test(text)) return Number(text);
  if (!/[十百千]/.test(text)) return Number([...text].map(char => digits[char] ?? '').join(''));
  let total = 0, digit = 0;
  for (const char of text) {
    if (char in digits) digit = digits[char];
    else { total += (digit || 1) * ({ 十: 10, 百: 100, 千: 1000 }[char] || 0); digit = 0; }
  }
  return total + digit;
}
export function episodeHeading(line) {
  const title = line.normalize('NFKC').trim().replace(/^#{1,6}\s*/, '').replace(/^\*\*(.*?)\*\*$/, '$1');
  if (!title || title.length > 120 || /^(?:△|▲|\[(?:EN|ES|ZH|CN)\])/i.test(title)) return null;
  const match = title.match(/^(?:[【\[])?(?:第\s*)?([0-9零〇一二两三四五六七八九十百千]+)\s*[集话回](?=$|[\s:：\-—·、.。】\]])/)
    || title.match(/^(?:[【\[])?(?:EP(?:ISODE)?\.?\s*)(\d+)(?=$|[\s:：\-—·、.。】\]])/i)
    || title.match(/^[^:："“”\[\]【】]{1,50}?\s+第\s*([0-9零〇一二两三四五六七八九十百千]+)\s*集(?=$|[\s:：\-—·、.。])/);
  if (!match) return null;
  const number = episodeNumber(match[1]);
  return Number.isInteger(number) && number > 0 && number <= 9999 ? { number, title: line.trim().replace(/^#{1,6}\s*/, '').slice(0, 100) } : null;
}
export function splitEpisodes(text) {
  if (typeof text !== 'string' || !text.trim()) fail('请先粘贴多集剧本。');
  if (text.length > BATCH_TEXT_LIMIT) fail('一次最多粘贴 100 万字符，请分批导入。');
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  const headings = rows.flatMap((line, index) => { const heading = episodeHeading(line); return heading ? [{ ...heading, index }] : []; });
  if (!headings.length) fail('未找到集数标题。请让每集以单独一行的“第1集”“第一集”或“Episode 1”开头。');
  if (headings.length > BATCH_TASK_LIMIT) fail('每批最多 200 集，请拆分后导入。');
  const preamble = rows.slice(0, headings[0].index).join('\n').trim();
  const seen = new Set();
  const episodes = headings.map((heading, index) => {
    if (seen.has(heading.number)) fail(`同一批出现重复的第 ${heading.number} 集，请检查标题，或将不同剧目分批导入。`);
    seen.add(heading.number);
    const end = headings[index + 1]?.index ?? rows.length;
    const body = rows.slice(heading.index + 1, end).join('\n').trim();
    if (!body) fail(`第 ${heading.number} 集只有标题，没有剧本正文。`);
    const script = [preamble, rows.slice(heading.index, end).join('\n').trim()].filter(Boolean).join('\n\n');
    if (script.length > SCRIPT_LIMIT) fail(`第 ${heading.number} 集超过 ${SCRIPT_LIMIT} 字符，请缩短该集或分批处理。`);
    return { episodeNumber: heading.number, title: heading.title, script, startLine: heading.index + 1, endLine: end };
  });
  return { episodes, preamble };
}
export function batchSubtitleLines(task, preserve = true) {
  const language = task.settings.subtitleLanguage;
  const rows = task.script.split('\n');
  const heading = rows.findIndex(line => episodeHeading(line));
  const subtitleScript = rows.map((line, index) => index <= heading ? '' : line).join('\n');
  // Keep the existing workspace's Chinese punctuation behavior unchanged.
  const selected = language === 'auto' && !/\[(?:EN|ES(?:[-_](?:ES|MX|LA|419))?|ESP|SPA|SPANISH|ESPAÑOL|西语|西班牙语)(?:\]|\s)|【(?:EN|ES|西语)】|(?:西语|西班牙语|Español|Spanish)\s*[:：]/i.test(subtitleScript) ? 'zh' : language;
  return selected === 'zh' ? extractChineseSubtitles(subtitleScript, { preservePunctuation: preserve }) : splitScript(subtitleScript, selected);
}
export function nextBatchGroup(tasks, onlyIds = []) {
  const pending = tasks.filter(task => (!onlyIds.length || onlyIds.includes(task.id)) && ['queued', 'paused'].includes(task.status));
  const first = pending[0];
  if (!first) return [];
  const episodeLimit = first.settings.segmented ? Math.min(BATCH_GROUP_EPISODES, Math.floor(24 / (first.settings.segmentCount || 3))) : BATCH_GROUP_EPISODES;
  let length = 0; const group = [];
  for (const task of pending) {
    if (task.settings.analyzerKey !== first.settings.analyzerKey || !!task.settings.segmented !== !!first.settings.segmented || (task.settings.segmented && task.settings.segmentCount !== first.settings.segmentCount)) continue;
    if (group.length && (group.length >= episodeLimit || length + task.script.length > BATCH_GROUP_CHARACTERS)) break;
    group.push(task); length += task.script.length;
  }
  return group;
}

// The queue is independent of the current page; one website conversation runs at a time.
// Providers and credentials are resolved at execution and never persisted with the scripts.
export function createBatchAnalysisQueue({ load, save, analyze, extract = task => batchSubtitleLines(task), makeId = () => crypto.randomUUID() }) {
  let state = { loaded: false, running: false, activeIds: [], tasks: [], error: '' };
  let pendingSave = Promise.resolve(), run = null, controller = null, generation = 0, initializing;
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const persist = () => {
    const data = { version: 1, tasks: state.tasks };
    pendingSave = pendingSave.catch(() => {}).then(() => save(data));
    return pendingSave.catch(error => { publish({ error: `任务保存失败：${error.message}。请先导出备份，再继续分析。` }); throw error; });
  };
  const update = (id, patch) => publish({ tasks: state.tasks.map(task => task.id === id ? { ...task, ...patch } : task) });
  const initialize = () => initializing ||= (async () => {
    try {
      const data = await load();
      if (data && (data.version !== 1 || !Array.isArray(data.tasks))) fail('任务存档格式无效，请先备份。');
      const tasks = (data?.tasks || []).map(task => ({ ...task, status: task.status === 'analyzing' ? 'paused' : task.status }));
      publish({ loaded: true, tasks });
    } catch (error) { publish({ error: `无法读取跑量任务：${error.message}` }); }
  })();
  const assertIdle = () => { if (!state.loaded) fail('任务存档尚未加载。'); if (run || state.running) fail('请先中断当前分析，再修改任务。'); };
  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    snapshot: () => state,
    initialize,
    async import(episodes, settings) {
      assertIdle();
      if (!episodes.length) fail('没有可导入的集数。');
      if (!settings.analyzerKey) fail('请选择分析模型。');
      if (!['auto', 'en', 'es', 'zh'].includes(settings.subtitleLanguage)) fail('请选择有效字幕语言。');
      const batchId = makeId(), now = new Date().toISOString();
      const safeSettings = { analyzerKey: settings.analyzerKey, subtitleLanguage: settings.subtitleLanguage, ...segmentOptions(settings) };
      const added = episodes.filter(episode => !state.tasks.some(task => task.script === episode.script && task.settings.analyzerKey === safeSettings.analyzerKey && task.settings.subtitleLanguage === safeSettings.subtitleLanguage && !!task.settings.segmented === safeSettings.segmented && (!safeSettings.segmented || task.settings.segmentCount === safeSettings.segmentCount))).map(episode => ({ ...episode, id: makeId(), batchId, settings: safeSettings, status: 'queued', createdAt: now, subtitleCount: null, result: null, error: '' }));
      if (state.tasks.length + added.length > BATCH_TASK_LIMIT) fail('最多保留 200 个任务。请先导出结果并清理不再需要的任务。');
      const previous = state.tasks;
      publish({ tasks: [...state.tasks, ...added], error: '' });
      try { await persist(); } catch (error) { publish({ tasks: previous }); throw error; }
      return added.length;
    },
    async remove(id) { assertIdle(); const previous = state.tasks; publish({ tasks: state.tasks.filter(task => task.id !== id), error: '' }); try { await persist(); } catch (error) { publish({ tasks: previous }); throw error; } },
    async clear() { assertIdle(); const previous = state.tasks; publish({ tasks: [], error: '' }); try { await persist(); } catch (error) { publish({ tasks: previous }); throw error; } },
    async retry(id, analyzerKey, options) { assertIdle(); const task = state.tasks.find(task => task.id === id); if (!task) return; const previous = state.tasks; update(id, { status: 'queued', error: '', settings: { ...task.settings, ...(analyzerKey ? { analyzerKey } : {}), ...(options ? segmentOptions(options) : {}) } }); try { await persist(); } catch(error) { publish({tasks:previous}); throw error; } },
    pause() { generation++; controller?.abort(); publish({ running: false }); },
    start(onlyIds = []) {
      if (run) return run;
      if (!state.loaded) return Promise.reject(new Error('任务存档尚未加载。'));
      const token = ++generation;
      publish({ running: true, error: '' });
      run = (async () => {
        try {
          await persist();
          while (state.running && token === generation) {
            const group = nextBatchGroup(state.tasks, onlyIds);
            if (!group.length) break;
            controller = new AbortController();
            publish({ activeIds: group.map(task => task.id) });
            for (const task of group) update(task.id, { status: 'analyzing', error: '' });
            try {
              for (const task of group) update(task.id, { subtitleCount: extract(task).length });
              await persist();
              if (token !== generation) { for (const task of group) update(task.id, { status: 'paused' }); break; }
              const results = await analyze(group, controller.signal);
              if (token !== generation || controller.signal.aborted) { for (const task of group) update(task.id, { status: 'paused' }); break; }
              if (!Array.isArray(results) || results.length !== group.length || new Set(results.map(item => item.id)).size !== group.length || group.some(task => !results.some(result => result.id === task.id && result.value?.analysis && Array.isArray(result.value.matches)))) fail('模型未完整返回本批次全部集数的配乐结果，请重试本批次。');
              for (const result of results) update(result.id, { status: 'complete', result: result.value, revision: result.revision, analyzer: result.analyzer, completedAt: new Date().toISOString() });
              await persist();
            } catch (error) {
              for (const task of group) update(task.id, { status: token !== generation || controller.signal.aborted ? 'paused' : 'error', error: token !== generation ? '' : error.message });
              await persist();
              break; // Authentication, service or persistence errors need attention before another request.
            }
          }
          await persist();
        } catch (error) { publish({ error: state.error || error.message }); }
        finally { controller = null; run = null; publish({ running: false, activeIds: [] }); }
      })();
      return run;
    },
  };
}
