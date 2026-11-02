using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace XM.Native {
    internal static class WebsiteUpdates {
        internal const string Site = "https://kdhrbm.github.io/XM-Editing-Studio-Website/";
        internal const string Feed = Site + "update.json";
        internal static int Compare(string a, string b) { return new Version(a).CompareTo(new Version(b)); }
        private static bool IsVersion(string value) { Version parsed; return Regex.IsMatch(value ?? "", @"^\d+\.\d+\.\d+$") && Version.TryParse(value, out parsed); }
        internal static object Select(object feed, string current) {
            if (J.Num(feed, "schemaVersion") != 1 || !IsVersion(current)) throw new Exception("网站更新清单格式不支持，请稍后重试。");
            object downloads = J.Get(feed, "downloads");
            if (J.Map(downloads).Count == 0) throw new Exception("网站尚未提供更新包信息。");
            var available = new List<object>(); bool newerIncompatible = false; int validPackages = 0;
            foreach (string kind in new[] { "installer", "incremental" }) {
                object item = J.Get(downloads, kind); if (item == null) continue;
                string version = J.Str(item, "version"), name = J.Str(item, "name"), minimum = J.Str(item, "fromVersion");
                if (!IsVersion(version) || J.Str(item, "type") != kind) throw new Exception("网站更新版本格式无效。");
                string pattern = kind == "installer" ? "^XM-Editing-Studio-" + Regex.Escape(version) + @"-Windows-x64-Setup\.exe$" : "^XM-Editing-Studio-" + Regex.Escape(minimum) + "-to-" + Regex.Escape(version) + @"-Incremental-\d{8}\.zip$";
                if (!Regex.IsMatch(name, pattern) || kind == "incremental" && (!IsVersion(minimum) || Compare(minimum, version) > 0)) throw new Exception("网站更新包名称或适用版本无效。");
                string expectedUrl = "https://github.com/KDHRBm/XM-Editing-Studio/releases/download/v" + version + "/" + name;
                if (J.Str(item, "url") != expectedUrl || !Regex.IsMatch(J.Str(item, "sha"), "^[a-fA-F0-9]{64}$") || J.Num(item, "size") <= 0 || J.Num(item, "size") > 2L * 1024 * 1024 * 1024 || J.Num(item, "size") != Math.Floor(J.Num(item, "size"))) throw new Exception("网站更新包地址、大小或 SHA-256 校验信息无效。");
                validPackages++;
                if (Compare(version, current) <= 0) continue;
                if (kind == "incremental" && Compare(current, minimum) < 0) { newerIncompatible = true; continue; }
                available.Add(item);
            }
            if (validPackages == 0) throw new Exception("网站尚未提供可用的更新包信息。");
            var selected = available.OrderByDescending(item => new Version(J.Str(item, "version"))).ThenBy(item => J.Str(item, "type") == "incremental" ? 0 : 1).FirstOrDefault();
            if (selected == null && newerIncompatible) throw new Exception("网站有新版本，但需要先安装较新的全量包。请打开发布网站查看适用版本。");
            return selected;
        }
        internal static async Task<object> Check(HttpClient http, string current, CancellationToken token) {
            using (var request = new HttpRequestMessage(HttpMethod.Get, Feed + "?t=" + DateTime.UtcNow.Ticks)) {
                request.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true, NoStore = true };
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                using (var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token)) {
                    response.EnsureSuccessStatusCode();
                    if (response.RequestMessage != null && response.RequestMessage.RequestUri.GetLeftPart(UriPartial.Path) != Feed) throw new Exception("更新清单被重定向到其他地址。");
                    using (var input = await response.Content.ReadAsStreamAsync()) using (var buffer = new MemoryStream()) {
                        byte[] chunk = new byte[8192]; int read;
                        while ((read = await input.ReadAsync(chunk, 0, chunk.Length, token)) > 0) {
                            if (buffer.Length + read > 262144) throw new Exception("网站更新清单过大。");
                            buffer.Write(chunk, 0, read);
                        }
                        return Select(J.Decode(Encoding.UTF8.GetString(buffer.ToArray()).TrimStart('\ufeff')), current);
                    }
                }
            }
        }
        internal static string PreparePatch(string archive, string parent, string version, string expectedHash) {
            if (!IsVersion(version) || !J.FileHash(archive).Equals(expectedHash, StringComparison.OrdinalIgnoreCase)) throw new Exception("更新压缩包校验失败，请重新下载。");
            string directory = Path.Combine(Path.GetFullPath(parent), "update-" + version + "-" + Guid.NewGuid().ToString("N"));
            for (string at = Path.GetFullPath(parent); !string.IsNullOrEmpty(at); at = Path.GetDirectoryName(at))
                if (Directory.Exists(at) && (File.GetAttributes(at) & FileAttributes.ReparsePoint) != 0) throw new Exception("更新目录不能包含链接。");
            Directory.CreateDirectory(directory);
            try {
                using (var zip = ZipFile.OpenRead(archive)) {
                    if (zip.Entries.Count == 0 || zip.Entries.Count > 10000) throw new Exception("更新压缩包文件数量异常。");
                    var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total = 0;
                    foreach (var entry in zip.Entries) {
                        string relative = entry.FullName.Replace('\\', '/').TrimEnd('/');
                        if (relative.Length == 0) continue;
                        if (relative.Split('/').Any(part => part.Length == 0 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) || ((entry.ExternalAttributes >> 16) & 0xf000) == 0xa000) throw new Exception("更新压缩包包含无效路径。");
                        string destination = J.Under(directory, relative);
                        if (!paths.Add(destination)) throw new Exception("更新压缩包存在重复文件。");
                        if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\")) { Directory.CreateDirectory(destination); continue; }
                        total += entry.Length; if (total > 2L * 1024 * 1024 * 1024) throw new Exception("更新压缩包解压大小异常。");
                        Directory.CreateDirectory(Path.GetDirectoryName(destination));
                        using (var input = entry.Open()) using (var output = new FileStream(destination, FileMode.CreateNew)) {
                            byte[] chunk = new byte[131072]; int read;
                            while ((read = input.Read(chunk, 0, chunk.Length)) > 0) { if (output.Length + read > entry.Length) throw new Exception("更新文件大小异常。"); output.Write(chunk, 0, read); }
                            if (output.Length != entry.Length) throw new Exception("更新文件不完整。");
                        }
                    }
                }
                string name = "XM-Editing-Studio-" + version + "-Update.exe";
                var candidates = Directory.GetFiles(directory, name, SearchOption.AllDirectories);
                if (candidates.Length != 1 || !Directory.Exists(Path.Combine(Path.GetDirectoryName(candidates[0]), "payload"))) throw new Exception("更新包缺少安装器或载荷。");
                return candidates[0];
            } catch { Directory.Delete(directory, true); throw; }
        }
    }
}
