using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace XM.Native {
    // Detection and installation share sources. Only GitHub's official API supplies
    // the expected hash; a mirror can supply bytes, never its own checksum.
    internal static class LocalRuntimeDownload {
        internal sealed class Asset {
            internal string Url, Sha256;
            internal long Size;
        }
        internal const string ReleaseApi = "https://api.github.com/repos/ollama/ollama/releases/latest";

        internal static async Task<Asset> GetAsset(HttpClient http, CancellationToken token, int timeoutMs = 15000) {
            try {
                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(token)) {
                    timeout.CancelAfter(timeoutMs);
                    using (var response = await http.GetAsync(ReleaseApi, timeout.Token).ConfigureAwait(false)) {
                        EnsureSuccess(response);
                        object release = J.Decode(await response.Content.ReadAsStringAsync().ConfigureAwait(false));
                        object asset = J.Arr(J.Get(release, "assets")).FirstOrDefault(item => J.Str(item, "name") == "ollama-windows-amd64.zip");
                        string url = J.Str(asset, "browser_download_url"), digest = J.Str(asset, "digest");
                        double size = J.Num(asset, "size");
                        if (!Regex.IsMatch(url, @"\Ahttps://github\.com/ollama/ollama/releases/download/[A-Za-z0-9._-]+/ollama-windows-amd64\.zip\z")
                            || !Regex.IsMatch(digest, @"\Asha256:[a-fA-F0-9]{64}\z") || size <= 0 || size > 20L * 1024 * 1024 * 1024 || size != Math.Floor(size))
                            throw new InvalidDataException("官方运行环境下载信息无效，未使用未经校验的下载地址。");
                        return new Asset { Url = url, Sha256 = digest.Substring(7), Size = (long)size };
                    }
                }
            } catch (OperationCanceledException) {
                token.ThrowIfCancellationRequested();
                throw new TimeoutException("查询运行环境官方版本超时，请稍后重试。");
            } catch (HttpRequestException error) {
                throw new HttpRequestException("查询运行环境官方版本失败（" + SafeError(error) + "），请稍后重试。", error);
            }
        }

        private static string[] Sources(Asset asset) { return new[] { asset.Url, "https://gh-proxy.com/" + asset.Url }; }
        private static string Label(int index) { return index == 0 ? "官方地址" : "国内镜像"; }
        private static void EnsureSuccess(HttpResponseMessage response) {
            if (!response.IsSuccessStatusCode) throw new HttpRequestException("HTTP " + (int)response.StatusCode);
        }
        private static void CheckContent(HttpResponseMessage response, Asset asset, bool probe) {
            EnsureSuccess(response);
            var headers = response.Content.Headers;
            string type = headers.ContentType == null ? "" : headers.ContentType.MediaType;
            if (type.StartsWith("text/", StringComparison.OrdinalIgnoreCase) || type.IndexOf("json", StringComparison.OrdinalIgnoreCase) >= 0)
                throw new InvalidDataException("返回网页而非运行环境文件");
            if (probe && response.StatusCode == HttpStatusCode.PartialContent) {
                var range = headers.ContentRange;
                if (range == null || range.Unit != "bytes" || range.From != 0 || range.To != 3 || range.Length != asset.Size
                    || (headers.ContentLength.HasValue && headers.ContentLength != 4)) throw new InvalidDataException("文件分段信息不一致");
            } else if (response.StatusCode != HttpStatusCode.OK || (headers.ContentLength.HasValue && headers.ContentLength != asset.Size)) {
                throw new InvalidDataException("文件大小与官方发布不一致");
            }
        }
        private static string SafeError(Exception error) {
            if (error is OperationCanceledException || error is TimeoutException) return "连接超时";
            if (error is HttpRequestException) {
                var match = Regex.Match(error.Message, @"\AHTTP \d{3}\z");
                return match.Success ? match.Value : "网络连接失败";
            }
            if (error is InvalidDataException) return error.Message;
            return "传输中断";
        }
        private static Exception Failed(List<string> failures, bool timedOut) {
            string message = "运行环境文件暂时无法连接（" + string.Join("；", failures) + "）。请检查网络后重试。";
            return timedOut ? (Exception)new TimeoutException(message) : new IOException(message);
        }

        internal static async Task<string> Probe(HttpClient http, Asset asset, CancellationToken token, int timeoutMs = 8000) {
            var failures = new List<string>(); bool timedOut = false;
            string[] sources = Sources(asset);
            for (int index = 0; index < sources.Length; index++) {
                token.ThrowIfCancellationRequested();
                CancellationToken attemptToken = CancellationToken.None;
                try {
                    using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(token)) {
                        attemptToken = timeout.Token;
                        timeout.CancelAfter(timeoutMs);
                        using (var request = new HttpRequestMessage(HttpMethod.Get, sources[index])) {
                            request.Headers.Range = new RangeHeaderValue(0, 3);
                            using (var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false))
                            using (timeout.Token.Register(() => response.Dispose())) {
                                CheckContent(response, asset, true);
                                using (var input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false)) {
                                    byte[] prefix = new byte[4]; int read = 0, count;
                                    while (read < prefix.Length && (count = await input.ReadAsync(prefix, read, prefix.Length - read, timeout.Token).ConfigureAwait(false)) > 0) read += count;
                                    if (read != 4 || prefix[0] != 0x50 || prefix[1] != 0x4b || prefix[2] != 3 || prefix[3] != 4)
                                        throw new InvalidDataException("返回内容不是运行环境压缩包");
                                }
                            }
                        }
                    }
                    return Label(index);
                } catch (Exception error) {
                    token.ThrowIfCancellationRequested();
                    bool expired = attemptToken.IsCancellationRequested || error is OperationCanceledException;
                    if (!expired && !(error is HttpRequestException || error is IOException || error is InvalidDataException)) throw;
                    timedOut |= expired;
                    failures.Add(Label(index) + (expired ? "连接超时" : SafeError(error)));
                }
            }
            throw Failed(failures, timedOut);
        }

        internal static async Task Download(HttpClient http, Asset asset, string destination, CancellationToken token,
            Action<string, string, long, long> report, int headerTimeoutMs = 15000, int idleTimeoutMs = 30000) {
            var failures = new List<string>(); bool timedOut = false;
            string[] sources = Sources(asset);
            for (int index = 0; index < sources.Length; index++) {
                token.ThrowIfCancellationRequested();
                CancellationToken attemptToken = CancellationToken.None;
                try {
                    if (report != null) report("runtime", "正在通过" + Label(index) + "下载运行环境", 0, asset.Size);
                    using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(token)) {
                        attemptToken = timeout.Token;
                        timeout.CancelAfter(headerTimeoutMs);
                        using (var response = await http.GetAsync(sources[index], HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false))
                        using (timeout.Token.Register(() => response.Dispose())) {
                            CheckContent(response, asset, false);
                            using (var input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                            using (var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 1024, true)) {
                                var buffer = new byte[1024 * 1024]; long completed = 0; int count;
                                while (true) {
                                    timeout.CancelAfter(idleTimeoutMs);
                                    count = await input.ReadAsync(buffer, 0, buffer.Length, timeout.Token).ConfigureAwait(false);
                                    if (count == 0) break;
                                    if (completed + count > asset.Size) throw new InvalidDataException("文件大小超出官方发布大小");
                                    await output.WriteAsync(buffer, 0, count, timeout.Token).ConfigureAwait(false);
                                    completed += count;
                                    if (report != null && (completed == count || completed % (16 * 1024 * 1024) < count))
                                        report("runtime", "正在通过" + Label(index) + "下载运行环境", completed, asset.Size);
                                }
                                if (completed != asset.Size) throw new InvalidDataException("运行环境文件下载不完整");
                            }
                        }
                    }
                    token.ThrowIfCancellationRequested();
                    if (report != null) report("verify", "正在校验官方文件…", 0, 0);
                    string hash = await Task.Run(() => J.FileHash(destination), token).ConfigureAwait(false);
                    if (!hash.Equals(asset.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("运行环境 SHA-256 校验失败");
                    token.ThrowIfCancellationRequested();
                    return;
                } catch (Exception error) {
                    if (File.Exists(destination)) File.Delete(destination);
                    token.ThrowIfCancellationRequested();
                    bool expired = attemptToken.IsCancellationRequested || error is OperationCanceledException;
                    if (!expired && !(error is HttpRequestException || error is IOException || error is InvalidDataException)) throw;
                    timedOut |= expired;
                    failures.Add(Label(index) + (expired ? "连接超时" : SafeError(error)));
                }
            }
            throw Failed(failures, timedOut);
        }
    }
}
