using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Net;
using System.Net.Sockets;
using System.Diagnostics;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace XM.Native {
    // Optional transfer endpoint for external Chrome/Edge. The main UI uses no server.
    internal sealed class BrowserWatermark : IDisposable {
        private readonly string clientDirectory, dataDirectory;
        private TcpListener listener;
        private string origin;
        private readonly CancellationTokenSource closing = new CancellationTokenSource();
        private readonly Dictionary<string, BrowserTask> sessions = new Dictionary<string, BrowserTask>();
        private readonly object gate = new object();
        private sealed class Source {
            public string Path, Name, Type; public long Size, Modified;
            public object Metadata(object id) { return J.Obj("id", id, "name", Name, "size", Size, "type", Type); }
            public void Validate() { var file = new FileInfo(Path); if (!file.Exists || file.Length != Size || file.LastWriteTimeUtc.Ticks != Modified || (file.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("素材已改变，请重新选择。"); }
        }
        private sealed class BrowserTask { public Source[] Files; public Source Watermark; public object Settings; public string Browser; public long Accessed; }
        internal BrowserWatermark(string directory, string data) { clientDirectory = directory; dataDirectory = data; }
        internal static object[] Discover() {
            var output = new List<object>();
            foreach (string id in new[] { "edge", "chrome" }) {
                string relative = id == "edge" ? @"Microsoft\Edge\Application\msedge.exe" : @"Google\Chrome\Application\chrome.exe";
                string file = new[] { Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) }.Select(root => System.IO.Path.Combine(root, relative)).FirstOrDefault(File.Exists);
                output.Add(J.Obj("id", id, "name", id == "edge" ? "Microsoft Edge" : "Google Chrome", "available", file != null, "executable", file ?? ""));
            }
            return output.ToArray();
        }
        private static Source ReadSource(string path, bool image) {
            if (!System.IO.Path.IsPathRooted(path)) throw new Exception("请选择本地素材。"); var file = new FileInfo(path);
            var types = image ? new Dictionary<string, string> { { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".webp", "image/webp" } } : new Dictionary<string, string> { { ".mp4", "video/mp4" }, { ".m4v", "video/mp4" }, { ".mov", "video/quicktime" }, { ".webm", "video/webm" }, { ".mkv", "video/x-matroska" }, { ".avi", "video/x-msvideo" } };
            string type; if (!file.Exists || file.Length == 0 || !types.TryGetValue(file.Extension.ToLowerInvariant(), out type) || (file.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("选择的素材为空或格式不支持。");
            return new Source { Path = file.FullName, Name = file.Name, Type = type, Size = file.Length, Modified = file.LastWriteTimeUtc.Ticks };
        }
        internal object Open(object input, string[] paths) {
            closing.Token.ThrowIfCancellationRequested(); int count = (int)J.Num(input, "count"); bool hasWatermark = J.Bool(input, "hasWatermark");
            if (count < 0 || count > 100 || paths.Length != count + (hasWatermark ? 1 : 0)) throw new Exception("一次最多传递100个视频。");
            var browser = Discover().FirstOrDefault(x => J.Str(x, "id") == J.Str(input, "browser") && J.Bool(x, "available")); if (browser == null) throw new Exception("未找到所选 Chrome / Edge。");
            var files = paths.Take(count).Select(p => ReadSource(p, false)).ToArray(); var watermark = hasWatermark ? ReadSource(paths.Last(), true) : null;
            if (listener == null) { listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(); origin = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port; Listen(); }
            var bytes = new byte[32]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes); string token = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
            var settings = J.Get(input, "settings"); var task = new BrowserTask { Files = files, Watermark = watermark, Browser = J.Str(browser, "name"), Accessed = J.Now(), Settings = J.Obj("engine", new[] { "auto", "webav", "ffmpeg" }.Contains(J.Str(settings, "engine")) ? J.Str(settings, "engine") : "auto", "size", J.Str(settings, "size") == "720" ? "720" : "original", "crf", new[] { "18", "23", "28" }.Contains(J.Str(settings, "crf")) ? J.Str(settings, "crf") : "23", "audio", J.Str(settings, "audio") == "aac" ? "aac" : "auto", "hardware", "prefer-hardware") };
            lock (gate) { foreach (string key in sessions.Where(x => J.Now() - x.Value.Accessed > 12 * 3600000L).Select(x => x.Key).ToArray()) sessions.Remove(key); if (sessions.Count >= 8) throw new Exception("浏览器任务过多，请关闭并重新打开软件。"); sessions[token] = task; }
            try { Process.Start(new ProcessStartInfo(J.Str(browser, "executable"), J.Quote("--user-data-dir=" + Path.Combine(dataDirectory, "browser-watermark", J.Str(browser, "id"))) + " " + J.Quote("--disk-cache-dir=" + Path.Combine(dataDirectory, "cache", "browser-watermark")) + " " + J.Quote("--app=" + origin + "/watermarker/index.html#session=" + token)) { UseShellExecute = false }); }
            catch { lock (gate) sessions.Remove(token); throw; }
            return J.Obj("browser", task.Browser, "count", files.Length);
        }
        private async void Listen() {
            while (!closing.IsCancellationRequested) { try { var client = await listener.AcceptTcpClientAsync(); Serve(client); } catch { if (closing.IsCancellationRequested) return; } }
        }
        private async void Serve(TcpClient client) {
            using (client) using (var cts = CancellationTokenSource.CreateLinkedTokenSource(closing.Token)) {
                cts.CancelAfter(180000);
                try { using (var stream = client.GetStream()) {
                    var header = new MemoryStream(); byte[] one = new byte[1];
                    while (header.Length < 16384) { if (await stream.ReadAsync(one, 0, 1, cts.Token) == 0) return; header.WriteByte(one[0]); var b = header.GetBuffer(); long n = header.Length; if (n >= 4 && b[n-4] == 13 && b[n-3] == 10 && b[n-2] == 13 && b[n-1] == 10) break; }
                    var lines = Encoding.ASCII.GetString(header.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None); var first = lines[0].Split(' ');
                    var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase); foreach (string line in lines.Skip(1)) { int i = line.IndexOf(':'); if (i > 0) headers[line.Substring(0, i)] = line.Substring(i + 1).Trim(); }
                    string host, originHeader, site;
                    if (first.Length != 3 || !headers.TryGetValue("Host", out host) || "http://" + host != origin || headers.TryGetValue("Origin", out originHeader) && originHeader != origin || headers.TryGetValue("Sec-Fetch-Site", out site) && site == "cross-site") { await Reply(stream, 403, "text/plain", Encoding.UTF8.GetBytes("拒绝跨站访问"), cts.Token); return; }
                    if (first[0] != "GET" && first[0] != "HEAD") { await Reply(stream, 405, "text/plain", new byte[0], cts.Token); return; }
                    string route = new Uri(origin + first[1]).AbsolutePath, file = null, mime = "application/octet-stream";
                    if (route.StartsWith("/session/", StringComparison.Ordinal)) {
                        string auth; headers.TryGetValue("Authorization", out auth); BrowserTask task = null;
                        lock (gate) { if (auth != null && auth.StartsWith("Bearer ")) sessions.TryGetValue(auth.Substring(7), out task); if (task != null && J.Now() - task.Accessed <= 12 * 3600000L) task.Accessed = J.Now(); else task = null; }
                        if (task == null) { await Reply(stream, 401, "application/json", Encoding.UTF8.GetBytes("{\"error\":\"任务已失效，请重新打开\"}"), cts.Token); return; }
                        if (route == "/session/info") { var body = J.Obj("browser", task.Browser, "files", task.Files.Select((x, i) => x.Metadata(i)).ToArray(), "watermark", task.Watermark == null ? null : task.Watermark.Metadata("watermark"), "settings", task.Settings); await Reply(stream, 200, "application/json", Encoding.UTF8.GetBytes(J.Encode(body)), cts.Token); return; }
                        Source item = null; int index;
                        if (route == "/session/watermark") item = task.Watermark;
                        else if (route.StartsWith("/session/file/") && int.TryParse(route.Substring(14), out index) && index >= 0 && index < task.Files.Length) item = task.Files[index];
                        if (item != null) { item.Validate(); file = item.Path; mime = item.Type; }
                    } else if (route.StartsWith("/watermarker/", StringComparison.Ordinal)) {
                        file = J.Under(System.IO.Path.Combine(clientDirectory, "watermarker"), Uri.UnescapeDataString(route.Substring(13)).Replace('/', System.IO.Path.DirectorySeparatorChar));
                        string ext = System.IO.Path.GetExtension(file).ToLowerInvariant(); mime = ext == ".html" ? "text/html; charset=utf-8" : ext == ".js" ? "text/javascript" : ext == ".css" ? "text/css" : ext == ".wasm" ? "application/wasm" : ext == ".png" ? "image/png" : "application/octet-stream";
                    }
                    if (file == null || !File.Exists(file)) { await Reply(stream, 404, "text/plain", new byte[0], cts.Token); return; }
                    using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                        long start = 0, end = input.Length - 1; string range; bool partial = headers.TryGetValue("Range", out range);
                        if (partial) { var match = Regex.Match(range, @"^bytes=(\d*)-(\d*)$"); if (!match.Success || match.Groups[1].Length + match.Groups[2].Length == 0) { await Reply(stream, 416, "text/plain", new byte[0], cts.Token); return; } if (match.Groups[1].Length > 0) { start = long.Parse(match.Groups[1].Value); if (match.Groups[2].Length > 0) end = Math.Min(end, long.Parse(match.Groups[2].Value)); } else start = Math.Max(0, input.Length - long.Parse(match.Groups[2].Value)); }
                        if (start < 0 || start > end) { await Reply(stream, 416, "text/plain", new byte[0], cts.Token); return; }
                        await WriteHeader(stream, partial ? 206 : 200, mime, end - start + 1, partial ? "Content-Range: bytes " + start + "-" + end + "/" + input.Length + "\r\n" : "", cts.Token);
                        if (first[0] == "HEAD") return; input.Position = start; byte[] buffer = new byte[65536]; long remaining = end - start + 1; int read;
                        while (remaining > 0 && (read = await input.ReadAsync(buffer, 0, (int)Math.Min(buffer.Length, remaining), cts.Token)) > 0) { await stream.WriteAsync(buffer, 0, read, cts.Token); remaining -= read; }
                    }
                }} catch { /* Disconnection or expired session closes only this request. */ }
            }
        }
        private static async Task WriteHeader(Stream stream, int status, string mime, long length, string extra, CancellationToken token) { byte[] bytes = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + " " + (status == 200 ? "OK" : status == 206 ? "Partial Content" : "Error") + "\r\nContent-Type: " + mime + "\r\nContent-Length: " + length + "\r\nConnection: close\r\nCache-Control: no-store\r\nAccept-Ranges: bytes\r\nCross-Origin-Resource-Policy: same-origin\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n" + extra + "\r\n"); await stream.WriteAsync(bytes, 0, bytes.Length, token); }
        private static async Task Reply(Stream stream, int status, string type, byte[] body, CancellationToken token) { await WriteHeader(stream, status, type, body.Length, "", token); await stream.WriteAsync(body, 0, body.Length, token); }
        public void Dispose() { closing.Cancel(); if (listener != null) listener.Stop(); lock (gate) sessions.Clear(); }
    }
    internal sealed partial class StudioHost { private BrowserWatermark browserWatermark; }
}
