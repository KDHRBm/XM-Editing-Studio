import { normalizeMusicOptions, buildSunoBody } from '../shared/music-options.mjs';
import { getSunoSongs } from '../server/suno-response.mjs';
import { isScriptAnalysisModel, isLocalQwenModel, scoreMessages, parseScoreResponse, validateScoreRequest } from '../shared/script-score.mjs';
import { validateLibraryInput, keywordMessages, parseKeywords, shortlistTracks, matchMessages, parseMatches } from '../shared/library-match.mjs';
import { analyzeWithWeb } from '../shared/web-script-analysis.mjs';
import { analyzeBatchMusic } from '../shared/batch-music.mjs';
import { segmentMessages, parseSegments, planSegments, segmentCandidates, segmentMatchMessages, parseSegmentMatches } from '../shared/script-segments.mjs';
import { readLocalModelSettings } from '../shared/local-model-settings.mjs';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const OLLAMA_BASE_URL = 'http://127.0.0.1:11435/v1';

// Protocol and validation are shared by the legacy server and the native renderer.
export function createApiService(fetch = globalThis.fetch, onBatchStage = () => {}) {
function providerBaseUrl(provider) {
  if (provider?.protocol === 'deepseek') return DEEPSEEK_BASE_URL;
  if (provider?.protocol === 'qwen') return QWEN_BASE_URL;
  if (provider?.protocol === 'ollama') return OLLAMA_BASE_URL;
  return provider?.protocol === 'gemini' && !provider.baseUrl?.trim()
    ? DEFAULT_GEMINI_BASE_URL : provider?.baseUrl;
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error("请先填写 Base URL。"), { status: 400 });
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw Object.assign(new Error("Base URL 格式无效，请填写完整的 http 或 https 地址。"), { status: 400 });
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw Object.assign(new Error("Base URL 只支持 http 或 https 地址。"), { status: 400 });
  }
  return url;
}

function endpointUrl(baseUrl, endpoint) {
  const url = normalizeBaseUrl(baseUrl);
  const suffix = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (!url.pathname.replace(/\/+$/, "").endsWith(suffix)) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}${suffix}`;
  }
  return url;
}

function validateProvider(provider, model, allowSuno = false) {
  if (!provider || typeof provider !== "object") {
    throw Object.assign(new Error("找不到供应商配置。"), { status: 400 });
  }
  if (provider.protocol !== 'ollama' && !provider.apiKey?.trim()) {
    throw Object.assign(new Error("请先填写 API 密钥。"), { status: 400 });
  }
  if (typeof model !== "string" || !model.trim()) {
    throw Object.assign(new Error("请先添加并选择一个模型 ID。"), { status: 400 });
  }
  if (provider.protocol === "suno" && !allowSuno) {
    throw Object.assign(new Error("Suno 是音乐生成协议，请在音乐工作台中使用。"), { status: 400 });
  }
  normalizeBaseUrl(providerBaseUrl(provider));
}

async function requestProviderModels(provider) {
  if (!provider || typeof provider !== 'object') {
    throw Object.assign(new Error('找不到供应商配置。'), { status: 400 });
  }
  if (provider.protocol !== 'ollama' && !provider.apiKey?.trim()) {
    throw Object.assign(new Error('请先填写 API 密钥。'), { status: 400 });
  }
  const protocol = provider.protocol || 'openai';
  if (!['gemini', 'deepseek', 'deepseek-relay', 'qwen', 'openai', 'custom', 'anthropic', 'ollama'].includes(protocol)) {
    throw Object.assign(new Error('此协议不提供模型列表，请手动添加模型 ID。'), { status: 400 });
  }
  const url = endpointUrl(providerBaseUrl(provider), '/models');
  const headers = protocol === 'ollama' ? {}
    : protocol === 'gemini'
    ? { 'x-goog-api-key': provider.apiKey }
    : protocol === 'anthropic'
      ? { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${provider.apiKey}` };
  const entries = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const pageUrl = new URL(url);
    if (protocol === 'gemini') {
      pageUrl.searchParams.set('pageSize', '1000');
      if (pageToken) pageUrl.searchParams.set('pageToken', pageToken);
    }
    const response = await fetch(pageUrl, { method: 'GET', headers, signal: AbortSignal.timeout(30_000) });
    const { payload } = await readUpstreamResponse(response, provider.apiKey, '拉取模型列表失败');
    entries.push(...(Array.isArray(payload?.models) ? payload.models : Array.isArray(payload?.data) ? payload.data : []));
    pageToken = protocol === 'gemini' ? String(payload?.nextPageToken || '') : '';
    if (!pageToken) break;
  }
  const models = entries.filter(entry => {
    if (protocol !== 'gemini') return true;
    return !Array.isArray(entry?.supportedGenerationMethods) || entry.supportedGenerationMethods.includes('generateContent');
  }).map(entry => typeof entry === 'string' ? entry : entry?.name || entry?.id || '')
    .map(name => String(name).replace(/^models\//, ''))
    .filter(name => protocol === 'gemini'
      ? /^gemini-/i.test(name) && !/embedding|embed|imagen|image|tts|whisper|audio-only/i.test(name)
      : protocol === 'qwen' ? isScriptAnalysisModel(provider, name)
      : name && !/embedding|embed|tts|whisper/i.test(name));
  return [...new Set(models)];
}

function isSunoTaskModel(model) {
  return /^suno[_-]/i.test(String(model || ""));
}

function sunoEndpointUrl(baseUrl, endpoint) {
  const url = normalizeBaseUrl(baseUrl);
  url.pathname = url.pathname
    .replace(/\/v1(?:\/chat\/completions)?\/?$/i, "")
    .replace(/\/suno\/?$/i, "")
    .replace(/\/+$/, "");
  url.pathname = `${url.pathname}/suno/${endpoint.replace(/^\/+/, "")}` || "/";
  if (url.pathname.startsWith("//")) url.pathname = url.pathname.replace(/^\/+/, "/");
  return url;
}

function redactProviderKey(message, apiKey) {
  return apiKey ? String(message).replaceAll(apiKey, "••••••••") : String(message);
}

async function readUpstreamResponse(response, apiKey, action) {
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || payload?.msg || `服务返回 HTTP ${response.status}`;
    throw Object.assign(new Error(`${action}（${response.status}）：${redactProviderKey(detail, apiKey).slice(0, 400)}`), { status: 502, upstreamStatus: response.status, payload });
  }
  if (payload?.success === false || (payload?.code !== undefined && Number(payload.code) >= 400)) {
    const detail = payload?.error?.message || payload?.message || payload?.msg || "中转站返回了失败状态。";
    throw Object.assign(new Error(`${action}：${redactProviderKey(detail, apiKey).slice(0, 400)}`), { status: 502, payload });
  }
  return { payload, text };
}

async function requestSunoModelTest(provider, model) {
  validateProvider(provider, model, true);
  const startedAt = Date.now();
  const modelsUrl = endpointUrl(provider.baseUrl, "/models");
  let response;
  try {
    response = await fetch(modelsUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const message = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "模型列表查询超时，请检查服务地址。"
      : `无法连接到服务地址：${error?.message || "网络错误"}`;
    throw Object.assign(new Error(message), { status: 502 });
  }

  if (response.status === 401 || response.status === 403) {
    await readUpstreamResponse(response, provider.apiKey, "Suno 模型权限测试失败");
  }
  if (response.ok) {
    const { payload } = await readUpstreamResponse(response, provider.apiKey, "模型列表查询失败");
    const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
    const modelIds = entries.map((entry) => typeof entry === "string" ? entry : entry?.id || entry?.name).filter(Boolean).map(String);
    if (modelIds.some((id) => id.toLowerCase() === model.toLowerCase())) {
      return { ok: true, model, latencyMs: Date.now() - startedAt, message: `模型列表已确认 ${model}（未提交音乐任务）` };
    }
  }

  // Model directories may omit asynchronous media models. Probe the read-only
  // task lookup route with an impossible ID; this never creates a billable job.
  const probeUrl = sunoEndpointUrl(provider.baseUrl, "fetch");
  try {
    response = await fetch(probeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ ids: ["codex-connection-probe-no-task"] }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const message = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "Suno 异步任务接口查询超时。"
      : `无法连接 Suno 异步任务接口：${error?.message || "网络错误"}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  if (response.status === 401 || response.status === 403) {
    await readUpstreamResponse(response, provider.apiKey, "Suno 模型权限测试失败");
  }
  if (response.ok || response.status === 400 || response.status === 422) {
    return {
      ok: true,
      model,
      latencyMs: Date.now() - startedAt,
      message: `Suno 异步接口可达；本次未生成歌曲。请确认 Comfly 已为密钥开通 ${model}`,
    };
  }
  await readUpstreamResponse(response, provider.apiKey, "Suno 异步接口测试失败");
}

function buildProviderRequest(provider, model, messages, structured = false) {
  const protocol = provider.protocol || "openai";
  if (protocol === 'ollama') {
    const settings = readLocalModelSettings();
    return {
      url: new URL('/api/chat', OLLAMA_BASE_URL),
      headers: { 'Content-Type': 'application/json' },
      body: {
        model, messages, stream: false,
        ...(isLocalQwenModel(model) ? { think: false } : {}),
        ...(structured ? { format: typeof structured === 'object' ? structured : 'json' } : {}),
        options: { num_ctx: settings.contextTokens, num_predict: settings.outputTokens },
      },
    };
  }
  const url = endpointUrl(
    providerBaseUrl(provider),
    protocol === "anthropic"
      ? "/messages"
      : protocol === "gemini"
        ? `/models/${encodeURIComponent(model)}:generateContent`
        : "/chat/completions",
  );
  const headers = { "Content-Type": "application/json" };
  let body;

  if (protocol === "anthropic") {
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    const system = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n");
    body = {
      model,
      max_tokens: 2048,
      messages: messages.filter((item) => item.role !== "system"),
      ...(system ? { system } : {}),
    };
  } else if (protocol === "gemini") {
    headers["x-goog-api-key"] = provider.apiKey;
    const system = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n");
    body = {
      contents: messages.filter((item) => item.role !== "system").map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      })),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(structured ? { generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 16384 } } : {}),
    };
  } else {
    if (protocol !== 'ollama') headers.Authorization = `Bearer ${provider.apiKey}`;
    body = { model, messages, ...(['deepseek', 'deepseek-relay', 'qwen'].includes(protocol) ? { max_tokens: 8192 } : {}), ...(['deepseek', 'deepseek-relay', 'qwen'].includes(protocol) && structured ? { response_format: { type: 'json_object' } } : {}) };
    // Qwen structured output requires non-thinking mode, including models whose
    // default mode may change when an alias is updated by the provider.
    if (protocol === 'qwen') {
      body.enable_thinking = false;
      // The upstream JSON mode also requires the literal word JSON in a message.
      if (structured && !messages.some(message => /json/i.test(message.content))) {
        body.messages = [{ role: 'system', content: '只返回一个合法 JSON 对象。' }, ...messages];
      }
    }
  }

  return { url, headers, body };
}

function extractText(protocol, payload) {
  if (protocol === 'ollama') return payload?.message?.content || '';
  if (protocol === "anthropic") {
    return (payload?.content || []).filter((item) => item.type === "text").map((item) => item.text).join("");
  }
  if (protocol === "gemini") {
    return (payload?.candidates?.[0]?.content?.parts || []).map((item) => item.text || "").join("");
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item.text || "").join("");
  return "";
}

async function requestProvider(provider, model, messages, timeoutMs = 120_000, signal, structured = false) {
  validateProvider(provider, model);
  const { url, headers, body } = buildProviderRequest(provider, model, messages, structured);
  if (provider.protocol === 'ollama') timeoutMs = Math.max(timeoutMs, 720_000);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "请求超时，请检查服务地址或稍后重试。"
      : `无法连接到服务地址：${error?.message || "网络错误"}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { message: text.slice(0, 500) };
  }
  if (!response.ok) {
    let detail = payload?.error?.message || (typeof payload?.error === 'string' ? payload.error : '') || payload?.message || payload?.msg || `服务返回 HTTP ${response.status}`;
    if (provider.apiKey) detail = String(detail).replaceAll(provider.apiKey, "••••••••");
    throw Object.assign(new Error(`连接失败（${response.status}）：${String(detail).slice(0, 400)}`), { status: 502 });
  }
  const answer = extractText(provider.protocol || "openai", payload);
  const finishReason = payload?.candidates?.[0]?.finishReason || payload?.choices?.[0]?.finish_reason || payload?.done_reason || payload?.stop_reason || '';
  if (provider.protocol === 'qwen') {
    if (finishReason === 'length') throw Object.assign(new Error('千问 API 输出达到长度上限，分析未完成；请减少本批集数、分段数或缩短剧本后重试。'), { status: 502 });
    if (!answer.trim()) throw Object.assign(new Error('千问 API 返回空白内容，请检查模型连接后重试。'), { status: 502 });
  }
  if (provider.protocol === 'ollama' && structured && finishReason === 'length') {
    throw Object.assign(new Error('本地模型已达到输出 token 上限，未返回完整分析。请在“本地部署”提高最大输出 token，或缩短本集剧本。'), { status: 502 });
  }
  return { payload, text: provider.protocol === 'ollama' ? answer.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '') : answer, finishReason };
}

function asTrack(song) {
  if (!song || typeof song !== "object") return null;
  if (song.object === "chat.completion" || String(song.id || "").startsWith("chatcmpl-")) return null;
  const audioUrl = song.audio_url || song.audioUrl || song.stream_audio_url || song.streamAudioUrl || song.download_url || song.downloadUrl || song.url || "";
  const id = song.song_id || song.songId || song.clip_id || song.clipId || song.task_id || song.taskId || song.taskID || song.id || "";
  if (!audioUrl && !id) return null;
  return {
    id: String(id),
    taskId: String(song.task_id || song.taskId || song.taskID || id),
    title: song.song_title || song.title || song.name || "音乐生成结果",
    status: song.status || song.state || song.task_status || (audioUrl ? "completed" : "pending"),
    audioUrl,
    coverUrl: song.cover_url || song.coverUrl || song.image_url || song.imageUrl || "",
    duration: song.duration || song.duration_s || "",
  };
}

function parseMusicText(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(asTrack).filter(Boolean);
    const track = asTrack(parsed);
    if (track) return [track];
    for (const nested of [parsed.data, parsed.result, parsed.songs, parsed.clips, parsed.tasks, parsed.tracks]) {
      if (Array.isArray(nested)) return nested.map(asTrack).filter(Boolean);
      const nestedTrack = asTrack(nested);
      if (nestedTrack) return [nestedTrack];
    }
  } catch { /* plain text may still include a direct audio link */ }
  const audioLinks = [...text.matchAll(/https?:\/\/[^\s"'<>\])]+/g)]
    .map(([url]) => url.replace(/[.,;!?]+$/, ""))
    .filter((url) => /\.(mp3|wav|m4a|ogg|flac)(?:[?#].*)?$/i.test(url) || /audio|stream|download/i.test(url));
  return [...new Set(audioLinks)].map((audioUrl, index) => ({
    id: `audio-${index + 1}-${audioUrl}`,
    title: "音乐生成结果",
    status: "completed",
    audioUrl,
    coverUrl: "",
    duration: "",
  }));
}

function getMusicSongs(payload) {
  const candidates = [
    payload,
    payload?.data,
    payload?.result,
    payload?.songs,
    payload?.clips,
    payload?.tasks,
    payload?.tracks,
    payload?.data?.songs,
    payload?.data?.clips,
    payload?.data?.tasks,
    payload?.data?.tracks,
    payload?.result?.songs,
    payload?.result?.clips,
    payload?.result?.tasks,
    payload?.result?.tracks,
    payload?.response?.sunoData,
    payload?.response?.songs,
    payload?.response?.clips,
    payload?.choices?.[0]?.message?.audio,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const tracks = candidate.map(asTrack).filter(Boolean);
      if (tracks.length) return tracks;
    } else {
      const track = asTrack(candidate);
      if (track) return [track];
    }
  }
  const responseText = [
    payload?.choices?.[0]?.message?.content,
    ...(Array.isArray(payload?.content) ? payload.content : []).map((part) => part?.text),
    ...(Array.isArray(payload?.candidates?.[0]?.content?.parts) ? payload.candidates[0].content.parts : []).map((part) => part?.text),
    payload?.data,
    payload?.message?.content,
  ].filter((part) => typeof part === "string").join("\n");
  return parseMusicText(responseText);
}

function musicPrompt({ prompt, style, title, customMode, instrumental, durationSeconds }) {
  const details = [
    title ? `Title: ${title}` : "",
    customMode ? "Use the following lyrics and bracketed section instructions exactly:" : "",
    prompt.trim(),
    style ? `Style: ${String(style).slice(0, 500)}` : "",
    `Vocal: ${instrumental ? "instrumental only" : "include vocals"}`,
    durationSeconds != null && Number.isFinite(Number(durationSeconds)) ? `Approximate duration: ${Math.max(15, Math.min(480, Number(durationSeconds)))} seconds` : "",
  ].filter(Boolean);
  return `Create and generate an original music track from this brief. Submit it to the music-generation service and return its task ID and audio URL when available.\n\n${details.join("\n")}`;
}

function assertMusicProvider(provider, model) {
  validateProvider(provider, model, true);
  if (!["openai", "custom", "anthropic", "gemini", "suno"].includes(provider.protocol)) {
    throw Object.assign(new Error("音乐生成暂不支持此连接协议，请检查模型与连接中的协议设置。"), { status: 400 });
  }
}

async function requestMusic(provider, model, options) {
  assertMusicProvider(provider, model);
  if (provider.protocol === "suno" || isSunoTaskModel(model)) return requestSunoMusic(provider, model, options);
  const prompt = musicPrompt(options);
  const messages = [{ role: "user", content: prompt }];
  const { url, headers, body } = buildProviderRequest(provider, model, messages);
  // OpenAI-compatible music relays accept either a chat message or a top-level
  // prompt; the other adapters keep their protocol-specific request shape.
  const requestBody = ["openai", "custom"].includes(provider.protocol)
    ? { ...body, prompt, stream: false }
    : body;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    const message = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "中转站响应超时。请求可能已经提交；请先查看服务商任务记录，避免重复生成。"
      : `无法连接音乐模型中转站：${error?.message || "网络错误"}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    let detail = payload?.error?.message || payload?.message || payload?.msg || `服务返回 HTTP ${response.status}`;
    if (provider.apiKey) detail = String(detail).replaceAll(provider.apiKey, "••••••••");
    throw Object.assign(new Error(`音乐请求失败（${response.status}）：${String(detail).slice(0, 400)}`), { status: 502 });
  }
  if (payload?.success === false || (payload?.code !== undefined && Number(payload.code) >= 400)) {
    let detail = payload?.error?.message || payload?.message || payload?.msg || "中转站返回了失败状态。";
    if (provider.apiKey) detail = String(detail).replaceAll(provider.apiKey, "••••••••");
    throw Object.assign(new Error(String(detail).slice(0, 400)), { status: 502 });
  }
  return { payload, tracks: getMusicSongs(payload) };
}

async function requestSunoMusic(provider, model, options) {
  const url = sunoEndpointUrl(provider.baseUrl, "submit/music");
  const body = buildSunoBody(model, options);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    const message = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "Comfly 未及时确认 Suno 任务。请求可能已经提交，请先查看 Comfly 任务记录，避免重复生成。"
      : `无法连接 Suno 音乐任务接口：${error?.message || "网络错误"}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const { payload } = await readUpstreamResponse(response, provider.apiKey, "Suno 音乐任务提交失败");
  return { payload, tracks: getSunoSongs(payload) };
}

function musicQueryUrl(baseUrl, ids) {
  const url = normalizeBaseUrl(baseUrl);
  url.pathname = url.pathname.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
  url.pathname = url.pathname.endsWith("/api") ? `${url.pathname}/get` : `${url.pathname}/api/get`;
  url.search = new URLSearchParams({ ids: ids.join(",") }).toString();
  return url;
}

async function queryMusic(provider, model, ids) {
  assertMusicProvider(provider, model);
  if (provider.protocol === "suno" || isSunoTaskModel(model)) return querySunoMusic(provider, model, ids);
  const url = musicQueryUrl(provider.baseUrl, ids);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const detail = error?.name === "TimeoutError" || error?.name === "AbortError" ? "音乐任务状态查询超时。" : `无法查询音乐任务：${error?.message || "网络错误"}`;
    throw Object.assign(new Error(detail), { status: 502 });
  }
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 400) }; }
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || payload?.msg || `服务返回 HTTP ${response.status}`;
    throw Object.assign(new Error(`任务查询失败（${response.status}）：${String(detail).slice(0, 300)}`), { status: 502 });
  }
  return getMusicSongs(payload);
}

async function querySunoMusic(provider, model, ids) {
  const url = sunoEndpointUrl(provider.baseUrl, "fetch");
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const detail = error?.name === "TimeoutError" || error?.name === "AbortError" ? "Suno 任务状态查询超时。" : `无法查询 Suno 任务：${error?.message || "网络错误"}`;
    throw Object.assign(new Error(detail), { status: 502 });
  }
  if (response.status === 404 || response.status === 405) {
    const results = await Promise.all(ids.map(async (id) => {
      const singleUrl = sunoEndpointUrl(provider.baseUrl, `fetch/${encodeURIComponent(id)}`);
      const singleResponse = await fetch(singleUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${provider.apiKey}` },
        signal: AbortSignal.timeout(45_000),
      });
      return (await readUpstreamResponse(singleResponse, provider.apiKey, "Suno 任务查询失败")).payload;
    }));
    return results.flatMap(getSunoSongs);
  }
  const { payload } = await readUpstreamResponse(response, provider.apiKey, "Suno 任务查询失败");
  return getSunoSongs(payload);
}


const reply = (status, body) => ({ status, body });
return async function dispatch(url, body, signal = new AbortController().signal) {
signal.throwIfAborted();
  if (url === '/api/script/batch-library-match') {
    if (!isScriptAnalysisModel(body.provider, body.model)) throw Object.assign(new Error('请选择可用的剧本分析模型。'), { status: 400 });
    const abort = { signal };
    try {
      const result = await analyzeBatchMusic(body, async (messages, _label, schema) => {
        abort.signal.throwIfAborted();
        const result = await requestProvider(body.provider, body.model, messages, 240_000, abort.signal, body.provider.protocol === 'ollama' && schema === false ? false : body.provider.protocol === 'ollama' && schema ? schema : ['deepseek', 'deepseek-relay', 'qwen', 'ollama'].includes(body.provider.protocol));
        abort.signal.throwIfAborted();
        if (['deepseek', 'deepseek-relay'].includes(body.provider.protocol)) {
          if (result.finishReason === 'length') throw Object.assign(new Error('DeepSeek API 输出达到长度上限，音乐匹配未完成；请减少本批集数或分段数后重试。'), { status: 502 });
          if (!result.text.trim()) throw Object.assign(new Error(`DeepSeek API 返回空白内容${result.finishReason ? `（${result.finishReason}）` : ''}；请检查模型连接后重试。`), { status: 502 });
        }
        return result.text;
      }, { deepseekApi: ['deepseek', 'deepseek-relay', 'qwen', 'ollama'].includes(body.provider.protocol), localModel: body.provider.protocol === 'ollama', onStage: phase => onBatchStage(body.progressId, phase) });
      return reply(200, result);
    } finally {}
  }

  if (url === "/api/script/library-match") {
    if (!isScriptAnalysisModel(body.provider, body.model)) throw Object.assign(new Error("请选择可用的剧本分析模型。"), { status: 400 });
    const abort = { signal };
    try {
      const result = await analyzeWithWeb('library-match', body, async messages => {
        abort.signal.throwIfAborted();
        const answer = await requestProvider(body.provider, body.model, messages, 120_000, abort.signal, ['qwen', 'ollama'].includes(body.provider.protocol));
        abort.signal.throwIfAborted();
        return answer.text;
      });
      return reply(200, result);
    } finally {}
  }

  if (url === "/api/script/score") {
    if (!isScriptAnalysisModel(body.provider, body.model)) throw Object.assign(new Error("请选择可用的剧本分析模型连接。"), { status: 400 });
    const input = validateScoreRequest(body);
    if (input.segmented) {
      const abort = { signal };
      try {
        const segments = await planSegments(input, 'suno', messages => requestProvider(body.provider, body.model, messages, 120_000, abort.signal, true));
        return reply(200, { segments });
      } finally {}
    }
    const result = await requestProvider(body.provider, body.model, scoreMessages(input), 120_000, signal, ['qwen', 'ollama'].includes(body.provider.protocol));
    return reply(200, { score: parseScoreResponse(result.text, input.durationSeconds) });
  }

  if (url === "/api/providers/test") {
    const startedAt = Date.now();
    if (body.provider?.protocol === "suno" || isSunoTaskModel(body.model)) {
      const result = await requestSunoModelTest(body.provider, body.model);
      return reply(200, { ...result, latencyMs: result.latencyMs || Date.now() - startedAt });
    }
    const result = await requestProvider(body.provider, body.model, [{ role: "user", content: "请只回复 OK。" }], 45_000);
    return reply(200, {
      ok: true,
      model: body.model,
      latencyMs: Date.now() - startedAt,
      preview: result.text.slice(0, 120),
    });
  }

  if (url === '/api/providers/models') {
    return reply(200, { ok: true, models: await requestProviderModels(body.provider) });
  }

  if (url === "/api/chat") {
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw Object.assign(new Error("消息内容不能为空。"), { status: 400 });
    }
    const messages = body.messages.map((item) => ({
      role: ["system", "user", "assistant"].includes(item.role) ? item.role : "user",
      content: String(item.content ?? ""),
    }));
    const startedAt = Date.now();
    const result = await requestProvider(body.provider, body.model, messages);
    if (!result.text) throw Object.assign(new Error("接口已返回，但没有找到文本内容。请检查该中转站的协议格式。"), { status: 502 });
    return reply(200, { text: result.text, model: body.model, latencyMs: Date.now() - startedAt });
  }

  if (url === "/api/music/generate") {
    const options = normalizeMusicOptions(body);
    const result = await requestMusic(body.provider, body.model, options);
    if (!result.tracks.length) {
      const responseText = [
        result.payload?.choices?.[0]?.message?.content,
        ...(Array.isArray(result.payload?.content) ? result.payload.content : []).map((part) => part?.text),
        ...(Array.isArray(result.payload?.candidates?.[0]?.content?.parts) ? result.payload.candidates[0].content.parts : []).map((part) => part?.text),
        result.payload?.data,
      ].filter((part) => typeof part === "string").join(" ");
      const detail = typeof responseText === "string" && responseText.trim()
        ? `中转站收到了请求，但没有返回歌曲链接或任务 ID：${responseText.trim().slice(0, 220)}`
        : "中转站收到了请求，但响应中没有歌曲链接或任务 ID。请确认所选模型支持音乐生成，并符合该连接的协议。";
      throw Object.assign(new Error(detail), { status: 502 });
    }
    return reply(200, { tracks: result.tracks });
  }

  if (url === "/api/music/query") {
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String).filter(Boolean))].slice(0, 100) : [];
    if (!ids.length) throw Object.assign(new Error("没有可查询的音乐任务。"), { status: 400 });
    return reply(200, { tracks: await queryMusic(body.provider, body.model, ids) });
  }

  return reply(404, { error: "找不到这个本机 API 路径。" });
}

}
