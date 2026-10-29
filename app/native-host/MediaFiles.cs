using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private List<string> musicRoots = new List<string>();
        private Dictionary<string, object> libraryCatalog = J.Obj("directories", new object[0], "tracks", new object[0], "warning", "", "revision", "");
        private Dictionary<string, Dictionary<string, object>> tracks = new Dictionary<string, Dictionary<string, object>>();
        private readonly Dictionary<string, Tuple<string, long, long>> dragFiles = new Dictionary<string, Tuple<string, long, long>>();
        private readonly SemaphoreSlim libraryGate = new SemaphoreSlim(1, 1);
        private void InitLibrary() {
            try { musicRoots = J.Arr(J.Get(J.Read(Path.Combine(DataDir, "music-library.json"), null), "directories")).OfType<string>().Where(Path.IsPathRooted).Distinct(StringComparer.OrdinalIgnoreCase).Take(20).ToList(); }
            catch (Exception error) { libraryCatalog["warning"] = error.Message; }
            Task.Run(async () => { try { await ScanLibrary(); } catch (Exception error) { Log(error.Message); } });
        }
        private void SaveLibrary() { J.Save(Path.Combine(DataDir, "music-library.json"), J.Obj("version", 1, "directories", musicRoots)); }
        private async Task<object> ConnectMusicFolders(IEnumerable<string> folders) {
            var next = MusicDirectories.Merge(musicRoots, folders);
            J.Save(Path.Combine(DataDir, "music-library.json"), J.Obj("version", 1, "directories", next));
            musicRoots = next;
            return await ScanLibrary();
        }
        private async Task<object> ScanLibrary() {
            await libraryGate.WaitAsync();
            try {
                var roots = musicRoots.ToArray();
                return await Task.Run<object>(() => {
                    var index = new Dictionary<string, Dictionary<string, object>>(); var dirs = new List<object>(); var output = new List<object>(); int visited = 0, skipped = 0;
                    foreach (string root in roots) {
                        string libraryId = J.Hash(root.ToLowerInvariant()); var info = J.Obj("id", libraryId, "path", root, "count", 0, "error", ""); dirs.Add(info);
                        try {
                            ValidatePathChain(root);
                            var stack = new Queue<Tuple<string, int>>(); stack.Enqueue(Tuple.Create(root, 0)); int count = 0;
                            while (stack.Count > 0 && index.Count < 5000 && visited < 50000) {
                                var dir = stack.Dequeue(); string[] files;
                                try { files = Directory.GetFileSystemEntries(dir.Item1).OrderBy(x => x, StringComparer.CurrentCulture).ToArray(); } catch { if (dir.Item1 == root) throw; skipped++; continue; }
                                foreach (string file in files) {
                                    if (++visited > 50000 || index.Count >= 5000) break;
                                    try {
                                        var attrs = File.GetAttributes(file); if ((attrs & FileAttributes.ReparsePoint) != 0) { skipped++; continue; }
                                        if ((attrs & FileAttributes.Directory) != 0) { if (dir.Item2 < 12) stack.Enqueue(Tuple.Create(file, dir.Item2 + 1)); continue; }
                                        if (!Regex.IsMatch(file, @"\.(mp3|wav|flac|m4a|aac|ogg|opus|webm)$", RegexOptions.IgnoreCase)) continue;
                                        string id = J.Hash(Path.GetFullPath(file).ToLowerInvariant()); if (index.ContainsKey(id)) continue;
                                        var stat = new FileInfo(file); var track = J.Obj("id", id, "libraryId", libraryId, "title", Path.GetFileNameWithoutExtension(file), "relativePath", file.Substring(root.TrimEnd('\\').Length + 1), "size", stat.Length, "modifiedAt", (long)(stat.LastWriteTimeUtc - new DateTime(1970, 1, 1)).TotalMilliseconds);
                                        output.Add(new Dictionary<string, object>(track)); track["filename"] = file; track["root"] = root; index[id] = track; count++;
                                    } catch { skipped++; }
                                }
                            }
                            info["count"] = count;
                        } catch (Exception error) { info["error"] = "无法读取音乐文件夹：" + error.Message; }
                    }
                    tracks = index; libraryCatalog = J.Obj("directories", dirs, "tracks", output, "scannedAt", J.Now(), "revision", J.Hash(J.Encode(output)), "warning", index.Count >= 5000 || visited >= 50000 ? "扫描达到范围限制，请连接更具体的目录。" : skipped > 0 ? skipped + " 个无法访问项目或链接已跳过。" : "");
                    return libraryCatalog;
                });
            } finally { libraryGate.Release(); }
        }
        private string ResolveTrack(string id) {
            Dictionary<string, object> track; if (!tracks.TryGetValue(id, out track)) throw new Exception("音乐已移除或曲库尚未加载，请刷新。");
            string file = J.Str(track, "filename"); var stat = new FileInfo(file);
            ValidatePathChain(file);
            if (!stat.Exists || (stat.Attributes & FileAttributes.ReparsePoint) != 0 || stat.Length != (long)J.Num(track, "size") || (long)(stat.LastWriteTimeUtc - new DateTime(1970, 1, 1)).TotalMilliseconds != (long)J.Num(track, "modifiedAt")) throw new Exception("音乐文件已移动或更新，请刷新音乐库。");
            return file;
        }
        private void ConfigureResources(CoreWebView2 core) {
            core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (s, e) => {
                try {
                    var uri = new Uri(e.Request.Uri); string file;
                    if (e.Request.Method != "GET" && e.Request.Method != "HEAD") { e.Response = core.Environment.CreateWebResourceResponse(null, 405, "Method Not Allowed", "Allow: GET, HEAD"); return; }
                    if (e.Request.Headers.Contains("Origin") && e.Request.Headers.GetHeader("Origin") != Origin || e.Request.Headers.Contains("Sec-Fetch-Site") && e.Request.Headers.GetHeader("Sec-Fetch-Site") == "cross-site") { e.Response = core.Environment.CreateWebResourceResponse(null, 403, "Forbidden", "Cache-Control: no-store"); return; }
                    if (uri.AbsolutePath.StartsWith("/local-music/")) file = ResolveTrack(Uri.UnescapeDataString(uri.AbsolutePath.Substring(13)));
                    else if (uri.AbsolutePath.StartsWith("/companion-assets/")) { var rel = Uri.UnescapeDataString(uri.AbsolutePath.Substring(18)); if (!rel.EndsWith(".webm", StringComparison.OrdinalIgnoreCase)) throw new Exception("无效资源。"); file = J.Under(Path.Combine(PetDirectory, "_internal", "assets", "characters"), rel.Replace('/', Path.DirectorySeparatorChar)); }
                    else file = J.Under(ClientDir, Uri.UnescapeDataString(uri.AbsolutePath == "/" ? "index.html" : uri.AbsolutePath.Substring(1)).Replace('/', Path.DirectorySeparatorChar));
                    long size = new FileInfo(file).Length, start = 0, end = size - 1; bool partial = e.Request.Headers.Contains("Range");
                    if (partial) {
                        var match = Regex.Match(e.Request.Headers.GetHeader("Range"), @"^bytes=(\d*)-(\d*)$");
                        if (!match.Success || match.Groups[1].Value.Length + match.Groups[2].Value.Length == 0) throw new Exception("无效 Range。");
                        if (match.Groups[1].Length > 0) { start = long.Parse(match.Groups[1].Value); if (match.Groups[2].Length > 0) end = Math.Min(end, long.Parse(match.Groups[2].Value)); }
                        else start = Math.Max(0, size - long.Parse(match.Groups[2].Value));
                        if (start >= size || start < 0 || end < start) { e.Response = core.Environment.CreateWebResourceResponse(null, 416, "Range Not Satisfiable", "Content-Range: bytes */" + size); return; }
                    }
                    var type = Path.GetExtension(file).ToLowerInvariant();
                    string mime = type == ".html" ? "text/html; charset=utf-8" : type == ".js" ? "text/javascript; charset=utf-8" : type == ".css" ? "text/css; charset=utf-8" : type == ".svg" ? "image/svg+xml" : type == ".png" ? "image/png" : type == ".jpg" || type == ".jpeg" ? "image/jpeg" : type == ".wasm" ? "application/wasm" : type == ".woff2" ? "font/woff2" : type == ".json" ? "application/json" : type == ".webm" ? "video/webm" : type == ".mp3" ? "audio/mpeg" : type == ".m4a" ? "audio/mp4" : "audio/" + type.TrimStart('.');
                    string headers = "Content-Type: " + mime + "\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nContent-Length: " + (end - start + 1) + "\r\nCross-Origin-Resource-Policy: same-origin";
                    if (partial) headers += "\r\nContent-Range: bytes " + start + "-" + end + "/" + size;
                    var stream = e.Request.Method == "HEAD" ? null : new SliceStream(file, start, Math.Max(0, end - start + 1));
                    e.Response = core.Environment.CreateWebResourceResponse(stream, partial ? 206 : 200, partial ? "Partial Content" : "OK", headers);
                } catch (Exception error) { if (Environment.GetEnvironmentVariable("XM_NATIVE_QA") == "1") Log("resource-error " + error.Message); e.Response = core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "Cache-Control: no-store"); }
            };
        }
        private object PrepareDrag(object p) {
            string file = J.Str(p, "filePath"), id = J.Str(p, "libraryId");
            if (id.Length > 0) file = ResolveTrack(id);
            if (file.Length == 0) file = J.Str(J.Arr(J.Read(Path.Combine(DataDir, "saved-music-files.json"), new object[0])).LastOrDefault(x => J.Str(x, "url") == J.Str(p, "url")), "path");
            if (file.Length == 0) return J.Obj("ready", false, "reason", "作品尚未保存，暂不能拖入剪映。");
            ValidatePathChain(file); ValidateAudio(file);
            if (dragFiles.Count >= 2000) dragFiles.Clear();
            var stat = new FileInfo(file); string token = Guid.NewGuid().ToString("N"); dragFiles[token] = Tuple.Create(file, stat.Length, stat.LastWriteTimeUtc.Ticks);
            return J.Obj("ready", true, "token", token, "path", file, "name", Path.GetFileName(file));
        }
        private string ResolveDrag(string token) {
            Tuple<string, long, long> item; if (!dragFiles.TryGetValue(token, out item)) throw new Exception("拖动已过期。");
            ValidatePathChain(item.Item1); var stat = new FileInfo(item.Item1);
            if (!stat.Exists || stat.Length != item.Item2 || stat.LastWriteTimeUtc.Ticks != item.Item3) throw new Exception("音乐文件已变化，请重新选择。");
            ValidateAudio(item.Item1); return item.Item1;
        }
        private static void ValidatePathChain(string path) {
            for (string current = Path.GetFullPath(path); !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current)) {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new Exception("音乐路径包含已变化的链接，请重新连接真实文件夹。");
                if (current == Path.GetPathRoot(current)) break;
            }
        }
        private static string AudioExtension(byte[] b) {
            string head = Encoding.ASCII.GetString(b);
            if (b.Length < 16) throw new Exception("音频文件为空或不完整。");
            if (b[0] == 255 && (b[1] & 246) == 240) return ".aac";
            if (head.StartsWith("ID3") || b[0] == 255 && (b[1] & 224) == 224) return ".mp3";
            if (head.StartsWith("RIFF") && head.Substring(8, 4) == "WAVE") return ".wav";
            if (head.StartsWith("OggS")) return ".ogg"; if (head.StartsWith("fLaC")) return ".flac";
            if (head.Substring(4, 4) == "ftyp") return ".m4a";
            if (b.Take(4).SequenceEqual(new byte[] { 26, 69, 223, 163 })) return ".webm";
            throw new Exception("下载结果不是可识别的音频文件。");
        }
        private static void ValidateAudio(string file) { using (var stream = File.OpenRead(file)) { var b = new byte[Math.Min(64, stream.Length)]; stream.Read(b, 0, b.Length); AudioExtension(b); } }
        private static string SafeName(string name) { name = Regex.Replace(name ?? "", @"[<>:""/\\|?*\x00-\x1f]", "_").TrimEnd('.', ' '); if (name.Length == 0) name = "配乐"; if (Regex.IsMatch(name, @"^(con|prn|aux|nul|com\d|lpt\d)(\.|$)", RegexOptions.IgnoreCase)) name = "_" + name; return name.Substring(0, Math.Min(name.Length, 110)); }
        private async Task<object> DownloadAudio(object p) {
            string directory = J.Str(p, "directory"), url = J.Str(p, "url");
            if (!Path.IsPathRooted(directory) || !Http(url)) throw new Exception("音频地址或保存目录无效。");
            Directory.CreateDirectory(directory); string temp = J.Under(directory, ".xm-" + Guid.NewGuid().ToString("N") + ".download");
            try {
                using (var cts = new CancellationTokenSource(180000)) using (var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cts.Token)) {
                    response.EnsureSuccessStatusCode();
                    if (response.Content.Headers.ContentLength > 250L * 1024 * 1024) throw new Exception("音频超过250 MB。");
                    using (var input = await response.Content.ReadAsStreamAsync()) using (var output = new FileStream(temp, FileMode.CreateNew)) { var b = new byte[65536]; int n; while ((n = await input.ReadAsync(b, 0, b.Length, cts.Token)) > 0) { if (output.Length + n > 250L * 1024 * 1024) throw new Exception("音频超过250 MB。"); await output.WriteAsync(b, 0, n, cts.Token); } }
                }
                string ext; using (var stream = File.OpenRead(temp)) { var b = new byte[Math.Min(64, stream.Length)]; stream.Read(b, 0, b.Length); ext = AudioExtension(b); }
                string stem = SafeName(Regex.Replace(J.Str(p, "fileName", J.Str(p, "name", "配乐")), @"\.(mp3|wav|flac|m4a|aac|ogg|webm)$", "", RegexOptions.IgnoreCase));
                for (int n = 1; n < 10000; n++) {
                    string dest = J.Under(directory, stem + (n == 1 ? "" : "_" + n) + ext); if (File.Exists(dest)) continue;
                    try { File.Move(temp, dest); } catch (IOException) { if (File.Exists(dest)) continue; throw; }
                    var known = J.Arr(J.Read(Path.Combine(DataDir, "saved-music-files.json"), new object[0])).Where(x => J.Str(x, "url") != url).ToList(); known.Add(J.Obj("url", url, "path", dest)); J.Save(Path.Combine(DataDir, "saved-music-files.json"), known.Skip(Math.Max(0, known.Count - 2000)));
                    return J.Obj("ok", true, "path", dest, "audioPath", dest, "bytes", new FileInfo(dest).Length, "kind", "audio");
                }
                throw new Exception("同名音频过多。");
            } finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        private async Task<object> ExportMaterials(object p) {
            if (J.Str(p, "audioUrl").Length > 0) return await DownloadAudio(J.Obj("directory", J.Str(p, "directory"), "url", J.Str(p, "audioUrl"), "name", J.Str(p, "name")));
            string root = J.Str(p, "directory"); if (!Path.IsPathRooted(root)) throw new Exception("请选择保存目录。");
            string source = ResolveTrack(J.Str(p, "localTrackId")); ValidateAudio(source);
            string folder = J.Under(root, SafeName(J.Str(p, "title", "剧本配乐")) + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(folder); var created = new List<string>();
            try { string audio = J.Under(folder, "配乐" + Path.GetExtension(source)); File.Copy(source, audio, false); created.Add(audio);
                foreach (var text in J.Map(J.Get(p, "texts"))) { string dest = J.Under(folder, text.Key); using (var stream = new FileStream(dest, FileMode.CreateNew)) using (var writer = new StreamWriter(stream, new UTF8Encoding(false))) writer.Write(Convert.ToString(text.Value)); created.Add(dest); }
                return J.Obj("ok", true, "path", folder, "audioPath", audio, "bytes", new FileInfo(audio).Length);
            } catch { foreach (string file in created) File.Delete(file); if (!Directory.EnumerateFileSystemEntries(folder).Any()) Directory.Delete(folder); throw; }
        }
    }
    internal sealed class SliceStream : Stream {
        private readonly FileStream file; private readonly long start, length; private long position;
        public SliceStream(string path, long offset, long count) { file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete); start = offset; length = count; file.Position = start; }
        public override bool CanRead { get { return true; } } public override bool CanSeek { get { return true; } } public override bool CanWrite { get { return false; } }
        public override long Length { get { return length; } } public override long Position { get { return position; } set { Seek(value, SeekOrigin.Begin); } }
        public override int Read(byte[] b, int offset, int count) { int n = file.Read(b, offset, (int)Math.Min(count, length - position)); position += n; return n; }
        public override long Seek(long offset, SeekOrigin origin) { long next = (origin == SeekOrigin.Begin ? 0 : origin == SeekOrigin.Current ? position : length) + offset; if (next < 0 || next > length) throw new IOException("Invalid seek"); file.Position = start + next; return position = next; }
        public override void Flush() {} public override void SetLength(long value) { throw new NotSupportedException(); } public override void Write(byte[] b, int o, int c) { throw new NotSupportedException(); }
        protected override void Dispose(bool disposing) { if (disposing) file.Dispose(); base.Dispose(disposing); }
    }
}
