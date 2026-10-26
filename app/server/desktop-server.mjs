import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { handleApi } from "./api-plugin.mjs";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

function sendError(res, status, message) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ error: message }));
}

export async function serveStatic(req, res, clientDirectory) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    return res.end("Method not allowed");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  } catch {
    return sendError(res, 400, "请求路径无效。");
  }

  const root = path.resolve(clientDirectory);
  let filename = path.resolve(root, `.${pathname}`);
  if (!filename.startsWith(`${root}${path.sep}`) && filename !== root) {
    return sendError(res, 403, "拒绝访问此文件。");
  }

  try {
    const fileInfo = await stat(filename);
    if (fileInfo.isDirectory()) filename = path.join(filename, "index.html");
  } catch {
    if (path.extname(pathname)) return sendError(res, 404, "找不到此文件。");
    filename = path.join(root, "index.html");
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", contentTypes[path.extname(filename).toLowerCase()] || "application/octet-stream");
  res.setHeader("Cache-Control", path.basename(filename) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable");
  if (req.method === "HEAD") return res.end();

  const stream = createReadStream(filename);
  stream.on("error", () => {
    if (!res.headersSent) sendError(res, 404, "找不到此文件。");
    else res.destroy();
  });
  stream.pipe(res);
}

export function createDesktopServer({ clientDirectory, host = "127.0.0.1", port = 37651, musicLibrary }) {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/local-music/')) {
      if (!musicLibrary) return sendError(res, 404, '本地音乐库不可用。');
      musicLibrary.serve(req, res).catch(error => { if (!res.headersSent && !res.destroyed) sendError(res, error.status || 500, error.message || '无法读取本地音乐。'); });
      return;
    }
    if (req.url?.startsWith("/api/")) {
      handleApi(req, res).catch((error) => {
        if (!res.headersSent && !res.destroyed) sendError(res, error.status || 500, error.message || "本机 API 发生未知错误。");
      });
      return;
    }
    serveStatic(req, res, clientDirectory).catch(() => {
      if (!res.headersSent && !res.destroyed) sendError(res, 500, "无法读取应用文件。");
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}
