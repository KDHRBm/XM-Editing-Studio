import { normalizeMusicOptions, buildSunoBody } from '../shared/music-options.mjs';
import { getSunoSongs } from '../server/suno-response.mjs';
import { isGeminiModel, scoreMessages, parseScoreResponse, validateScoreRequest, materialTexts } from '../shared/script-score.mjs';
import { validateLibraryInput, keywordMessages, parseKeywords, shortlistTracks, matchMessages, parseMatches } from '../shared/library-match.mjs';
import { segmentMessages, segmentRetryMessages, parseSegments, segmentCandidates, segmentMatchMessages, parseSegmentMatches } from '../shared/script-segments.mjs';
import { buildJianyingAIRequest, DEFAULT_GEMINI_BASE_URL } from '../electron/jianying-ai.mjs';
import { webAIScriptPrompt } from '../shared/web-ai-prompts.mjs';
import { webAIPageScript } from '../electron/web-ai-dom.mjs';
import { normalizeSubtitlePunctuation } from '../shared/period-text.mjs';
import { musicFileStem } from '../shared/music-filename.mjs';

declare const window: any;

const wv = window.chrome?.webview;

if (wv && !window.blackObsidian) {
  let seq = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const listeners: Record<string, Set<(val: any) => void>> = {};

  const onEvent = (channel: string, cb: (val: any) => void) => {
    if (!listeners[channel]) listeners[channel] = new Set();
    listeners[channel].add(cb);
    return () => listeners[channel].delete(cb);
  };

  const emitLocal = (channel: string, value: any) => {
    const set = listeners[channel];
    if (set) for (const fn of set) { try { fn(value); } catch {} }
  };

  const invokeHost = (cmd: string, payload: any = {}): Promise<any> => {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      wv.postMessage(JSON.stringify({ id, cmd, payload }));
    });
  };

  wv.addEventListener('message', (event: any) => {
    const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (!msg) return;
    if (msg.event) {
      if (msg.event === 'bos:jianying-ai-request') {
        void handleJianyingAiFromHost(msg.data);
        return;
      }
      emitLocal(msg.event, msg.data);
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error));
      else entry.resolve(msg.result);
    }
  });

  // Upstream CORS-free fetch via Native C# Host
  const hostFetch = async (url: string | URL, options: any = {}) => {
    const res = await invokeHost('http-fetch', {
      url: String(url),
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body ? String(options.body) : '',
    });
    return {
      ok: Boolean(res.ok),
      status: Number(res.status) || 0,
      text: async () => String(res.body ?? ''),
      json: async () => JSON.parse(String(res.body || '{}')),
      headers: { get: (k: string) => (res.headers && res.headers[k.toLowerCase()]) || null },
    };
  };

  // Jianying AI Vision bridge when JianYingEngine.exe requests draft scan / AI rename
  let lastJyConnection: any = null;
  function formatProviderLabel(p: any) {
    const rawName = String(p?.name || '').trim();
    if (rawName && rawName !== 'Provider Select') return rawName;
    if (p?.protocol === 'gemini') return 'Gemini AI Studio';
    if (p?.protocol === 'openai') return 'OpenAI 兼容';
    if (p?.protocol === 'anthropic') return 'Anthropic';
    return String(p?.id || 'AI').trim();
  }
  function resolveJyConnection(reqModelKey?: string) {
    try {
      const cached = JSON.parse(
        localStorage.getItem('black-obsidian.providers.v1') ||
        localStorage.getItem('xm.providers.cache') ||
        '[]'
      );
      const savedKey = reqModelKey || localStorage.getItem('xm.jianying.model') || '';
      const models: any[] = [];
      for (const p of (Array.isArray(cached) ? cached : [])) {
        const pName = formatProviderLabel(p);
        const pid = p?.id || pName;
        for (const rawM of (Array.isArray(p?.models) ? p.models : [])) {
          const m = String(rawM || '').trim();
          if (!m) continue;
          models.push({ key: `${pid}::${m}`, provider: p, model: m });
        }
      }
      const matched = (savedKey ? models.find(item => item.key === savedKey) : null) || models[0] || null;
      if (matched?.provider?.apiKey) {
        lastJyConnection = matched;
        return matched;
      }
      if (lastJyConnection?.provider?.apiKey) return lastJyConnection;
      return null;
    } catch {
      return lastJyConnection;
    }
  }
  async function handleJianyingAiFromHost(req: any) {
    try {
      const conn = resolveJyConnection(req?.modelKey);
      if (!conn) throw new Error('请先在主窗口「接口与主题」中配置 Gemini 模型连接');
      const built = buildJianyingAIRequest(conn, { prompt: req.prompt, image: req.image });
      const resp = await hostFetch(built.url.toString(), {
        method: 'POST',
        headers: built.headers,
        body: JSON.stringify(built.body),
      });
      const raw = await resp.text();
      if (!resp.ok) throw new Error(`AI 请求失败 (HTTP ${resp.status})`);
      const parsed = JSON.parse(raw);
      const text =
        conn.provider?.protocol === 'gemini'
          ? (parsed?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('')
          : parsed?.choices?.[0]?.message?.content || '';
      if (!text || !text.trim()) {
        throw new Error('AI 返回内容为空，请检查模型连接');
      }
      await invokeHost('jianying-ai-reply', { id: req.id, token: req.token, text: String(text || '[]') });
    } catch (err: any) {
      await invokeHost('jianying-ai-reply', { id: req.id, token: req.token, error: err?.message || 'AI 识别失败' });
    }
  }

  // API Plugin logic running in-renderer with hostFetch
  function normalizeBaseUrl(value: string) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('请先填写 Base URL。');
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 只支持 http 或 https 地址。');
    return url;
  }
  function endpointUrl(baseUrl: string, endpoint: string) {
    const url = normalizeBaseUrl(baseUrl);
    const suffix = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    if (!url.pathname.replace(/\/+$/, '').endsWith(suffix)) {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}${suffix}`;
    }
    return url;
  }
  function sunoEndpointUrl(baseUrl: string, endpoint: string) {
    const url = normalizeBaseUrl(baseUrl);
    url.pathname = url.pathname.replace(/\/v1(?:\/chat\/completions)?\/?$/i, '').replace(/\/suno\/?$/i, '').replace(/\/+$/, '');
    url.pathname = `${url.pathname}/suno/${endpoint.replace(/^\/+/, '')}` || '/';
    return url;
  }
  function buildProviderRequest(provider: any, model: string, messages: any[]) {
    const protocol = provider.protocol || 'openai';
    const rawBaseUrl = protocol === 'gemini' && (!provider.baseUrl || !String(provider.baseUrl).trim())
      ? DEFAULT_GEMINI_BASE_URL
      : provider.baseUrl;
    const url = endpointUrl(
      rawBaseUrl,
      protocol === 'anthropic' ? '/messages' : protocol === 'gemini' ? `/models/${encodeURIComponent(model)}:generateContent` : '/chat/completions'
    );
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: any;
    if (protocol === 'anthropic') {
      headers['x-api-key'] = provider.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
      body = { model, max_tokens: 2048, messages: messages.filter(m => m.role !== 'system'), ...(system ? { system } : {}) };
    } else if (protocol === 'gemini') {
      headers['x-goog-api-key'] = provider.apiKey;
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
      body = {
        contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      };
    } else {
      headers.Authorization = `Bearer ${provider.apiKey}`;
      body = { model, messages };
    }
    return { url, headers, body };
  }
  function extractText(protocol: string, payload: any) {
    if (protocol === 'anthropic') return (payload?.content || []).filter((i: any) => i.type === 'text').map((i: any) => i.text).join('');
    if (protocol === 'gemini') return (payload?.candidates?.[0]?.content?.parts || []).map((i: any) => i.text || '').join('');
    const content = payload?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : Array.isArray(content) ? content.map((i: any) => i.text || '').join('') : '';
  }
  async function requestProvider(provider: any, model: string, messages: any[]) {
    if (!provider?.apiKey?.trim()) throw new Error('请先填写 API 密钥。');
    const { url, headers, body } = buildProviderRequest(provider, model, messages);
    const response = await hostFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await response.text();
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 500) }; }
    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || payload?.msg || `服务返回 HTTP ${response.status}`;
      throw new Error(`连接失败（${response.status}）：${String(detail).slice(0, 400)}`);
    }
    return { payload, text: extractText(provider.protocol || 'openai', payload) };
  }

  const sunoHeaders = (provider: any) => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    h['Auth' + 'orization'] = 'Bearer ' + String(provider?.apiKey || '');
    return h;
  };

  function compareGeminiModels(a: string, b: string): number {
    const getVer = (s: string) => {
      const m = s.match(/gemini-(\d+(?:\.\d+)?)/i);
      return m ? parseFloat(m[1]) : 0;
    };
    const verA = getVer(a);
    const verB = getVer(b);
    if (verA !== verB) return verB - verA;
    const isLiteA = /-lite/i.test(a);
    const isLiteB = /-lite/i.test(b);
    if (isLiteA !== isLiteB) return isLiteA ? 1 : -1;
    const isFlashA = /flash/i.test(a);
    const isFlashB = /flash/i.test(b);
    if (isFlashA !== isFlashB) return isFlashA ? -1 : 1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  async function handleLocalApi(pathname: string, body: any) {
    if (pathname === '/api/providers/models') {
      const provider = body.provider || {};
      if (!provider?.apiKey?.trim()) throw new Error('请先填写 API 密钥。');
      const protocol = provider.protocol || 'openai';
      if (protocol === 'gemini') {
        const rawBaseUrl = (!provider.baseUrl || !String(provider.baseUrl).trim())
          ? DEFAULT_GEMINI_BASE_URL
          : provider.baseUrl;
        const url = endpointUrl(rawBaseUrl, '/models');
        url.searchParams.set('key', provider.apiKey.trim());
        const resp = await hostFetch(url.toString(), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.apiKey.trim() },
        });
        const raw = await resp.text();
        if (!resp.ok) throw new Error(`获取 Gemini 模型失败 (HTTP ${resp.status})`);
        let payload: any;
        try { payload = JSON.parse(raw); } catch { payload = {}; }
        const rawModels = Array.isArray(payload?.models) ? payload.models : [];
        const filtered = rawModels
          .filter((m: any) => {
            const name = String(m.name || m.id || '').replace(/^models\//, '');
            if (!name) return false;
            const lower = name.toLowerCase();
            // 只要 gemini 模型
            if (!lower.includes('gemini')) return false;
            // 排除非文字模型（向量模型、图像生成模型、语音模型等）
            if (lower.includes('embedding') || lower.includes('embed')) return false;
            if (lower.includes('imagen') || lower.includes('image')) return false;
            if (lower.includes('tts') || lower.includes('whisper') || lower.includes('audio-only')) return false;
            // 文字生成模型：如果 API 返回了 supportedGenerationMethods，必须支持 generateContent
            if (Array.isArray(m.supportedGenerationMethods) && !m.supportedGenerationMethods.includes('generateContent')) {
              return false;
            }
            return true;
          })
          .map((m: any) => String(m.name || m.id || '').replace(/^models\//, ''))
          .filter(Boolean);
        filtered.sort(compareGeminiModels);
        return { ok: true, models: [...new Set(filtered)] };
      } else {
        const url = endpointUrl(provider.baseUrl, '/models');
        const resp = await hostFetch(url.toString(), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey.trim()}` },
        });
        const raw = await resp.text();
        if (!resp.ok) throw new Error(`获取模型失败 (HTTP ${resp.status})`);
        let payload: any;
        try { payload = JSON.parse(raw); } catch { payload = {}; }
        const list = (Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [])
          .map((m: any) => (typeof m === 'string' ? m : m.id || m.name || ''))
          .filter(Boolean);
        const isGeminiCard = /gemini/i.test(provider.name || '');
        const filteredList = isGeminiCard
          ? list.filter((m: string) => /gemini/i.test(m) && !/embedding|embed|imagen|tts|whisper/i.test(m))
          : list.filter((m: string) => !/embedding|embed|dall-e|tts|whisper/i.test(m));
        if (isGeminiCard) {
          filteredList.sort(compareGeminiModels);
        } else {
          filteredList.sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
        }
        return { ok: true, models: [...new Set(filteredList)] };
      }
    }
    if (pathname === '/api/providers/test') {
      const startedAt = Date.now();
      if (body.provider?.protocol === 'suno' || /^suno[_-]/i.test(String(body.model || ''))) {
        const probeUrl = sunoEndpointUrl(body.provider.baseUrl, 'fetch');
        const resp = await hostFetch(probeUrl, {
          method: 'POST',
          headers: sunoHeaders(body.provider),
          body: JSON.stringify({ ids: ['connection-probe'] }),
        });
        if (resp.status === 401 || resp.status === 403) throw new Error(`Suno 密钥验证失败 (HTTP ${resp.status})`);
        return { ok: true, model: body.model, latencyMs: Date.now() - startedAt, message: `Suno 异步接口可达 (${body.model})` };
      }
      const result = await requestProvider(body.provider, body.model, [{ role: 'user', content: '请只回复 OK。' }]);
      return { ok: true, model: body.model, latencyMs: Date.now() - startedAt, preview: result.text.slice(0, 120) };
    }
    if (pathname === '/api/chat') {
      const startedAt = Date.now();
      const result = await requestProvider(body.provider, body.model, body.messages || []);
      return { text: result.text, model: body.model, latencyMs: Date.now() - startedAt };
    }
    if (pathname === '/api/script/score') {
      const input = validateScoreRequest(body);
      if (input.segmented) {
        const result = await requestProvider(body.provider, body.model, segmentMessages(input, 'suno'));
        try {
          return { segments: parseSegments(result.text, input, 'suno') };
        } catch (err: any) {
          const retried = await requestProvider(body.provider, body.model, segmentRetryMessages(input, 'suno', result.text, err?.message));
          return { segments: parseSegments(retried.text, input, 'suno') };
        }
      }
      const result = await requestProvider(body.provider, body.model, scoreMessages(input));
      return { score: parseScoreResponse(result.text, input.durationSeconds) };
    }
    if (pathname === '/api/script/library-match') {
      const input = validateLibraryInput(body);
      if (input.segmented) {
        const planned = await requestProvider(body.provider, body.model, segmentMessages(input, 'library'));
        let parsedSegments;
        try {
          parsedSegments = parseSegments(planned.text, input, 'library');
        } catch (err: any) {
          const retried = await requestProvider(body.provider, body.model, segmentRetryMessages(input, 'library', planned.text, err?.message));
          parsedSegments = parseSegments(retried.text, input, 'library');
        }
        const candidates = segmentCandidates(input, parsedSegments);
        let segments;
        if (candidates.some((s: any) => s.candidates.length)) {
          const matched = await requestProvider(body.provider, body.model, segmentMatchMessages(input, candidates));
          segments = parseSegmentMatches(matched.text, candidates);
        } else {
          segments = candidates.map(({ candidates: _c, ...seg }: any) => ({ ...seg, matches: [], evaluated: 0 }));
        }
        return {
          segments,
          matches: [],
          analysis: { summary: `剧本已分为 ${segments.length} 个情节，各段音乐推荐见下方。`, keywords: [...new Set(segments.flatMap((s: any) => s.keywords))].slice(0, 30) },
          total: input.tracks.length,
          evaluated: candidates.reduce((n: number, s: any) => n + s.candidates.length, 0),
        };
      }
      const keywordsResult = await requestProvider(body.provider, body.model, keywordMessages(input));
      const analysis = parseKeywords(keywordsResult.text);
      const candidates = shortlistTracks(input.tracks, analysis.keywords, input.customKeywords);
      let matches: any[] = [];
      if (candidates.length) {
        const matchResult = await requestProvider(body.provider, body.model, matchMessages(input, analysis, candidates));
        matches = parseMatches(matchResult.text, candidates);
      }
      return { analysis, matches, customKeywords: input.customKeywords, total: input.tracks.length, evaluated: candidates.length };
    }
    if (pathname === '/api/music/generate') {
      const options = normalizeMusicOptions(body);
      const url = sunoEndpointUrl(body.provider.baseUrl, 'submit/music');
      const sunoBody = buildSunoBody(body.model, options);
      const resp = await hostFetch(url, {
        method: 'POST',
        headers: sunoHeaders(body.provider),
        body: JSON.stringify(sunoBody),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error?.message || payload?.message || `Suno 提交失败 (${resp.status})`);
      return { tracks: getSunoSongs(payload) };
    }
    if (pathname === '/api/music/query') {
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const url = sunoEndpointUrl(body.provider.baseUrl, 'fetch');
      const resp = await hostFetch(url, {
        method: 'POST',
        headers: sunoHeaders(body.provider),
        body: JSON.stringify({ ids }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error?.message || `Suno 查询失败 (${resp.status})`);
      return { tracks: getSunoSongs(payload) };
    }
    throw new Error('未知 API 路径: ' + pathname);
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: any, init?: any) => {
    const urlStr = typeof input === 'string' ? input : input?.url || String(input);
    if (urlStr.startsWith('/api/') || urlStr.startsWith(window.location.origin + '/api/')) {
      const pathname = new URL(urlStr, window.location.origin).pathname;
      try {
        const rawBody = init?.body ? JSON.parse(String(init.body)) : {};
        const result = await handleLocalApi(pathname, rawBody);
        return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err?.message || 'API 请求失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return origFetch(input, init);
  };

  window.blackObsidian = {
    layoutWebAI: (input: any) => invokeHost('web-ai-layout', input),
    webAIAction: (id: string, action: string) => invokeHost('web-ai-action', { id, action, script: webAIPageScript({ command: action === 'login' ? 'login' : 'probe', host: id === 'doubao' ? 'www.doubao.com' : 'chat.deepseek.com' }) }),
    copyWebAITask: (draft: any, purpose: string) => invokeHost('copy-plain', { text: webAIScriptPrompt(draft, purpose) }),
    analyzeWebScript: (request: any) => invokeHost('web-analysis-start', request),
    getWebAnalysisTask: () => invokeHost('web-analysis-status', {}),
    webAnalysisAction: (id: string, action: string, value: any) => invokeHost('web-analysis-action', { id, action, value }),
    onWebAnalysisTask: (cb: any) => onEvent('bos:web-analysis-task', cb),

    getWatermarkState: () => invokeHost('watermark:get-state'),
    chooseWatermarkVideos: () => invokeHost('watermark:choose-videos'),
    addWatermarkVideos: (filesOrPaths: any[]) => {
      const paths = (filesOrPaths || []).map((f: any) => (typeof f === 'string' ? f : f?.path || f?.name || '')).filter(Boolean);
      return invokeHost('watermark:add-videos', { paths });
    },
    chooseWatermarkImage: () => invokeHost('watermark:choose-image'),
    chooseWatermarkOutputDir: () => invokeHost('watermark:choose-output-dir'),
    updateWatermarkSettings: (patch: any) => invokeHost('watermark:update-settings', patch),
    removeWatermarkJob: (jobId: string) => invokeHost('watermark:remove-job', { jobId }),
    clearWatermarkJobs: (mode: string) => invokeHost('watermark:clear-jobs', { mode }),
    retryWatermarkJobs: () => invokeHost('watermark:retry-failed'),
    startWatermarkBatch: () => invokeHost('watermark:start'),
    cancelWatermarkBatch: () => invokeHost('watermark:cancel'),
    openWatermarkPath: (targetPath: string) => invokeHost('watermark:open-path', { targetPath }),
    onWatermarkState: (cb: any) => onEvent('bos:watermark-state', cb),

    onTrayNavigate: (cb: any) => onEvent('bos:tray-navigate', cb),
    prepareMusicDrag: (input: any) => invokeHost('prepare-music-drag', input),
    startMusicDrag: (token: string) => { void invokeHost('start-music-drag', { token }); },
    onMusicDragError: (cb: any) => onEvent('bos:music-drag-error', cb),

    getPeriodKeeperStatus: () => invokeHost('period-status'),
    probePeriodKeeper: () => invokeHost('period-probe'),
    setPeriodKeeperEnabled: (enabled: boolean, mode: string) => invokeHost('period-enabled', { enabled, mode }),
    copySubtitleText: (text: string) => invokeHost('period-copy', { text: String(text ?? '') }),

    jianyingAction: (action: string, args: any, connection: any) => {
      if (connection) lastJyConnection = connection;
      return invokeHost('jianying-action', { action, args: args || {} });
    },
    chooseJianyingFiles: () => invokeHost('jianying-files'),
    quickLaunch: (action: string, value: any) => invokeHost('quick-launch', { action, value }),
    chooseDirectory: () => invokeHost('choose-directory'),
    writeCache: (payload: any) => invokeHost('write-cache', payload),
    readCache: (payload: any) => invokeHost('read-cache', payload),
    downloadAudio: (payload: any) => invokeHost('download-audio', payload),
    exportScriptMaterials: async (payload: any) => {
      const job = payload?.job || {};
      const input = validateScoreRequest(job);
      const local = job.source === 'library';
      const score = local ? undefined : parseScoreResponse(JSON.stringify(job.score), input.durationSeconds);
      if (!local) {
        return invokeHost('download-audio', {
          directory: payload.directory,
          url: job.primary?.audioUrl,
          fileName: musicFileStem(score) + '.mp3',
        });
      }
      const analysis = parseKeywords(JSON.stringify(job.analysis));
      const texts = materialTexts({ ...input, source: 'library', score, analysis, localTrack: job.localTrack, matchReason: String(job.matchReason || '') });
      return invokeHost('export-script-materials', {
        directory: payload.directory,
        title: input.title || '剧本配乐',
        localTrackId: job.localTrack?.id,
        texts,
      });
    },
    getMusicLibrary: () => invokeHost('music-library-list'),
    connectMusicLibrary: () => invokeHost('music-library-connect'),
    refreshMusicLibrary: () => invokeHost('music-library-refresh'),
    disconnectMusicLibrary: (id: string) => invokeHost('music-library-disconnect', { id }),

    getUpdaterStatus: () => invokeHost('updater-status'),
    updaterAction: (action: string) => invokeHost('updater-action', { action }),
    onUpdaterState: (cb: any) => onEvent('bos:updater-state', cb),
    setTitleBarTheme: (scheme: string) => invokeHost('titlebar-theme', { scheme }),
    companionAction: (action: string, value: any) => invokeHost('companion-action', { action, value }),
    onCompanionState: (cb: any) => onEvent('bos:companion-state', cb),
    windowControl: (action: string) => invokeHost('window-control', { action }),
  };

  // Mount native window control buttons (Min / Max / Close) and titlebar drag handler ONLY on main window (never on floating companion windows)
  window.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('companion')) return;
    let lastSyncedProvidersJson = '';
    const syncProvidersToHost = () => {
      try {
        const raw = localStorage.getItem('black-obsidian.providers.v1') || localStorage.getItem('xm.providers.cache') || '';
        if (raw && raw !== lastSyncedProvidersJson) {
          lastSyncedProvidersJson = raw;
          try { localStorage.setItem('xm.providers.cache', raw); } catch {}
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            void invokeHost('companion-action', { action: 'sync-providers', value: parsed });
          }
        }
      } catch {}
    };
    syncProvidersToHost();
    setInterval(syncProvidersToHost, 1500);
    const bar = document.createElement('div');
    bar.className = 'bos-wv2-window-controls';
    bar.style.cssText = 'position:fixed;top:0;right:0;height:36px;width:138px;z-index:9999;display:grid;grid-template-columns:repeat(3,46px);-webkit-app-region:no-drag;user-select:none;';
    const mkBtn = (label: string, action: string, isClose = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = action === 'min' ? '最小化' : action === 'max' ? '最大化/还原' : '关闭';
      b.style.cssText = 'border:0;background:transparent;color:var(--ui-muted,#a1a8a5);font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;';
      b.onmouseenter = () => { b.style.background = isClose ? '#e81123' : 'rgba(255,255,255,0.08)'; b.style.color = '#fff'; };
      b.onmouseleave = () => { b.style.background = 'transparent'; b.style.color = 'var(--ui-muted,#a1a8a5)'; };
      b.onclick = () => invokeHost('window-control', { action });
      return b;
    };
    bar.append(mkBtn('─', 'min'), mkBtn('□', 'max'), mkBtn('✕', 'close', true));
    document.body.appendChild(bar);

    document.addEventListener('pointerdown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('button, a, input, select, textarea, .bos-titlebar-actions, .bos-wv2-window-controls')) return;
      if (target.closest('.bos-titlebar, header')) {
        void invokeHost('window-control', { action: 'drag' });
      }
    });
    document.addEventListener('dblclick', (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.bos-titlebar') && !target.closest('button, .bos-titlebar-actions, .bos-wv2-window-controls')) {
        void invokeHost('window-control', { action: 'max' });
      }
    });
  });
}
