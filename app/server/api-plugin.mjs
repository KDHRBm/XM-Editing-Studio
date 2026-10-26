import { normalizeMusicOptions, buildSunoBody } from '../shared/music-options.mjs';
import { getSunoSongs } from './suno-response.mjs';
import { isGeminiModel, scoreMessages, parseScoreResponse, validateScoreRequest } from '../shared/script-score.mjs';
import { validateLibraryInput, keywordMessages, parseKeywords, shortlistTracks, matchMessages, parseMatches } from '../shared/library-match.mjs';
import { analyzeWithWeb } from '../shared/web-script-analysis.mjs';
import { analyzeBatchMusic } from '../shared/batch-music.mjs';
import { segmentMessages, parseSegments, segmentCandidates, segmentMatchMessages, parseSegmentMatches } from '../shared/script-segments.mjs';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function readJson(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("请求内容过大。"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("请求内容不是有效 JSON。"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw Object.assign(new Error("拒绝无效来源的请求。"), { status: 403 });
  }
  if (originHost !== req.headers.host) {
    throw Object.assign(new Error("拒绝跨站请求。"), { status: 403 });
  }
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
  if (!provider.apiKey?.trim()) {
    throw Object.assign(new Error("请先填写 API 密钥。"), { status: 400 });
  }
  if (typeof model !== "string" || !model.trim()) {
    throw Object.assign(new Error("请先添加并选择一个模型 ID。"), { status: 400 });
  }
  if (provider.protocol === "suno" && !allowSuno) {
    throw Object.assign(new Error("Suno 是音乐生成协议，请在音乐工作台中使用。"), { status: 400 });
  }
  normalizeBaseUrl(provider.baseUrl);
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

function buildProviderRequest(provider, model, messages) {
  const protocol = provider.protocol || "openai";
  const url = endpointUrl(
    provider.baseUrl,
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
    };
  } else {
    headers.Authorization = `Bearer ${provider.apiKey}`;
    body = { model, messages };
  }

  return { url, headers, body };
}

function extractText(protocol, payload) {
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

async function requestProvider(provider, model, messages, timeoutMs = 120_000, signal) {
  validateProvider(provider, model);
  const { url, headers, body } = buildProviderRequest(provider, model, messages);
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
    let detail = payload?.error?.message || payload?.message || payload?.msg || `服务返回 HTTP ${response.status}`;
    if (provider.apiKey) detail = String(detail).replaceAll(provider.apiKey, "••••••••");
    throw Object.assign(new Error(`连接失败（${response.status}）：${String(detail).slice(0, 400)}`), { status: 502 });
  }
  return { payload, text: extractText(provider.protocol || "openai", payload) };
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

export async function handleApi(req, res) {
  assertSameOrigin(req);
  if (req.method !== "POST") return json(res, 405, { error: "仅支持 POST 请求。" });
  const body = await readJson(req, ['/api/script/library-match', '/api/script/batch-library-match'].includes(req.url) ? 5 * 1024 * 1024 : MAX_BODY_BYTES);

  if (req.url === '/api/script/batch-library-match') {
    if (!isGeminiModel(body.provider, body.model)) throw Object.assign(new Error('请选择可用的 Gemini 模型。'), { status: 400 });
    const abort = new AbortController();
    const disconnected = () => { if (!res.writableEnded) abort.abort(); };
    res.on('close', disconnected);
    try {
      const result = await analyzeBatchMusic(body, async messages => {
        abort.signal.throwIfAborted();
        const result = await requestProvider(body.provider, body.model, messages, 240_000, abort.signal);
        abort.signal.throwIfAborted();
        return result.text;
      });
      return json(res, 200, result);
    } finally { res.off('close', disconnected); }
  }

  if (req.url === "/api/script/library-match") {
    if (!isGeminiModel(body.provider, body.model)) throw Object.assign(new Error("请选择 Gemini 模型。"), { status: 400 });
    const abort = new AbortController();
    const disconnected = () => { if (!res.writableEnded) abort.abort(); };
    res.on('close', disconnected);
    try {
      const result = await analyzeWithWeb('library-match', body, async messages => {
        abort.signal.throwIfAborted();
        const answer = await requestProvider(body.provider, body.model, messages, 120_000, abort.signal);
        abort.signal.throwIfAborted();
        return answer.text;
      });
      return json(res, 200, result);
    } finally { res.off('close', disconnected); }
  }

  if (req.url === "/api/script/score") {
    if (!isGeminiModel(body.provider, body.model)) throw Object.assign(new Error("请选择 Gemini 模型及 Gemini 或 OpenAI 兼容连接。"), { status: 400 });
    const input = validateScoreRequest(body);
    if (input.segmented) {
      const result = await requestProvider(body.provider, body.model, segmentMessages(input, 'suno'), 120_000);
      return json(res, 200, { segments: parseSegments(result.text, input, 'suno') });
    }
    const result = await requestProvider(body.provider, body.model, scoreMessages(input), 120_000);
    return json(res, 200, { score: parseScoreResponse(result.text, input.durationSeconds) });
  }

  if (req.url === "/api/providers/test") {
    const startedAt = Date.now();
    if (body.provider?.protocol === "suno" || isSunoTaskModel(body.model)) {
      const result = await requestSunoModelTest(body.provider, body.model);
      return json(res, 200, { ...result, latencyMs: result.latencyMs || Date.now() - startedAt });
    }
    const result = await requestProvider(body.provider, body.model, [{ role: "user", content: "请只回复 OK。" }], 45_000);
    return json(res, 200, {
      ok: true,
      model: body.model,
      latencyMs: Date.now() - startedAt,
      preview: result.text.slice(0, 120),
    });
  }

  if (req.url === "/api/chat") {
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
    return json(res, 200, { text: result.text, model: body.model, latencyMs: Date.now() - startedAt });
  }

  if (req.url === "/api/music/generate") {
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
    return json(res, 200, { tracks: result.tracks });
  }

  if (req.url === "/api/music/query") {
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String).filter(Boolean))].slice(0, 100) : [];
    if (!ids.length) throw Object.assign(new Error("没有可查询的音乐任务。"), { status: 400 });
    return json(res, 200, { tracks: await queryMusic(body.provider, body.model, ids) });
  }

  return json(res, 404, { error: "找不到这个本机 API 路径。" });
}

export function localApiPlugin() {
  return {
    name: "black-obsidian-local-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        handleApi(req, res).catch((error) => {
          if (!res.headersSent && !res.destroyed) {
            json(res, error.status || 500, { error: error.message || "本机代理发生未知错误。" });
          }
        });
      });
    },
  };
}
