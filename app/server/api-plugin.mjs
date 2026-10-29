import { createApiService } from '../shared/api-service.mjs';
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

export async function handleApi(req, res) {
  assertSameOrigin(req);
  if (req.method !== 'POST') return json(res, 405, { error: '仅支持 POST 请求。' });
  const body = await readJson(req, ['/api/script/library-match', '/api/script/batch-library-match'].includes(req.url) ? 5 * 1024 * 1024 : MAX_BODY_BYTES);
  const abort = new AbortController();
  const disconnected = () => { if (!res.writableEnded) abort.abort(); };
  res.on('close', disconnected);
  try { const result = await createApiService()(req.url, body, abort.signal); return json(res, result.status, result.body); }
  finally { res.off('close', disconnected); }
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
