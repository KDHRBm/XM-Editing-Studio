using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private const string LocalModelHost = "http://127.0.0.1:11435";
        private static readonly string[] LocalModelNames = { "qwen3.5:4b", "qwen3.5:9b", "deepseek-r1:1.5b", "deepseek-r1:7b", "deepseek-r1:14b", "deepseek-r1:32b", "deepseek-r1:70b" };
        private readonly SemaphoreSlim localModelGate = new SemaphoreSlim(1, 1);
        private readonly SemaphoreSlim localStartGate = new SemaphoreSlim(1, 1);
        private CancellationTokenSource localModelCancel;
        private Process localModelServer;
        private object localModelProgress = J.Obj("stage", "idle", "message", "");
        private object localHardware;
        private string LocalModelRoot { get { return Path.Combine(DataDir, "local-ai"); } }
        private string LocalRuntime { get { return Path.Combine(LocalModelRoot, "runtime"); } }
        private string LocalModelsPath { get { return Path.Combine(LocalModelRoot, "models"); } }
        private string LocalOllamaExe { get { return Path.Combine(LocalRuntime, "ollama.exe"); } }

        private void ReportLocalModel(string stage, string message, long completed = 0, long total = 0) {
            localModelProgress = J.Obj("stage", stage, "message", message, "completed", completed, "total", total);
            Emit("bos:local-model-progress", localModelProgress);
        }
        private async Task<object> LocalModelStatus() {
            object[] models = LocalModelNames.Where(name => File.Exists(Path.Combine(LocalModelsPath, "manifests", "registry.ollama.ai", "library", name.Split(':')[0], name.Split(':')[1]))).Cast<object>().ToArray();
            bool running = false;
            try {
                using (var cts = new CancellationTokenSource(1500))
                using (var response = await http.GetAsync(LocalModelHost + "/api/tags", cts.Token)) {
                    if (response.IsSuccessStatusCode) {
                        var payload = J.Decode(await response.Content.ReadAsStringAsync());
                        models = models.Concat(J.Arr(J.Get(payload, "models")).Select(item => (object)J.Str(item, "name"))).Distinct().ToArray();
                        running = true;
                    }
                }
            } catch { /* The local service is not running yet. */ }
            return J.Obj("runtimeInstalled", File.Exists(LocalOllamaExe), "running", running,
                "models", models, "root", LocalModelRoot, "endpoint", LocalModelHost + "/v1",
                "progress", localModelProgress, "hardware", localHardware ?? (localHardware = await Task.Run(() => DetectLocalHardware())));
        }
        private async Task<object> LocalModelAction(string action, string model) {
            if (action == "detect") { localHardware = null; return await LocalModelStatus(); }
            if (action == "status") return await LocalModelStatus();
            if (action == "sources") return await CheckLocalModelSources(LocalModelNames.Contains(model, StringComparer.Ordinal) ? model : "deepseek-r1:7b");
            if (action == "cancel") { if (localModelCancel != null) localModelCancel.Cancel(); return await LocalModelStatus(); }
            if (action == "start") { await StartLocalModelServer(); return await LocalModelStatus(); }
            if (action == "stop") { await StopLocalModelServer(); return await LocalModelStatus(); }
            if (action != "install-runtime" && action != "pull") throw new Exception("无效的本地模型操作。");
            if (action == "pull" && !LocalModelNames.Contains(model, StringComparer.Ordinal)) throw new Exception("不支持此模型，请从列表中选择。");
            if (!await localModelGate.WaitAsync(0)) throw new Exception("已有本地模型下载任务正在进行。");
            using (var cts = new CancellationTokenSource()) {
                localModelCancel = cts;
                try {
                    if (action == "install-runtime") await InstallLocalRuntime(cts.Token);
                    else { await StartLocalModelServer(); await PullLocalModel(model, cts.Token); }
                    ReportLocalModel("done", action == "pull" ? model + " 已下载，可以加入分析模型。" : "本地运行环境已安装到 E 盘数据目录。");
                    return await LocalModelStatus();
                } catch (OperationCanceledException) { ReportLocalModel("cancelled", "下载已取消。已下载的模型分块可在下次继续使用。"); throw new Exception("下载已取消。"); }
                catch (Exception error) { if (cts.IsCancellationRequested) { ReportLocalModel("cancelled", "下载已取消。已下载的模型分块可在下次继续使用。"); throw new Exception("下载已取消。"); } ReportLocalModel("error", error.Message); throw; }
                finally { localModelCancel = null; localModelGate.Release(); }
            }
        }
        private async Task<object> CheckLocalModelSources(string model) {
            var runtimeTask = CheckRuntimeSource();
            var modelTask = CheckModelSource(model);
            await Task.WhenAll(runtimeTask, modelTask);
            return J.Obj("runtime", runtimeTask.Result, "model", modelTask.Result, "modelName", model);
        }
        private async Task<object> CheckRuntimeSource() {
            try {
                using (var cts = new CancellationTokenSource(30000))
                using (var release = await http.GetAsync("https://api.github.com/repos/ollama/ollama/releases/latest", cts.Token)) {
                    release.EnsureSuccessStatusCode();
                    var payload = J.Decode(await release.Content.ReadAsStringAsync());
                    var asset = J.Arr(J.Get(payload, "assets")).FirstOrDefault(item => J.Str(item, "name") == "ollama-windows-amd64.zip");
                    if (asset == null) throw new Exception("官方发布中没有 Windows x64 文件。");
                    string url = J.Str(asset, "browser_download_url"); Uri address;
                    if (!Uri.TryCreate(url, UriKind.Absolute, out address) || address.Scheme != "https" || address.Host != "github.com") throw new Exception("下载地址无效。");
                    bool headAvailable = false;
                    try {
                        using (var request = new HttpRequestMessage(HttpMethod.Head, address))
                        using (var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token)) {
                            response.EnsureSuccessStatusCode();
                            headAvailable = true;
                        }
                    } catch (OperationCanceledException) { throw; }
                    catch { /* Some release CDNs reject HEAD; probe one byte below. */ }
                    if (!headAvailable) {
                        using (var request = new HttpRequestMessage(HttpMethod.Get, address)) {
                            request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 0);
                            using (var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token)) {
                                if (response.StatusCode != System.Net.HttpStatusCode.PartialContent) throw new Exception("下载服务器未提供文件分段检测。");
                            }
                        }
                    }
                    return J.Obj("ok", true, "message", "Windows 运行环境文件可连接");
                }
            } catch (Exception error) { return J.Obj("ok", false, "message", "运行环境下载源不可用：" + error.Message); }
        }
        private async Task<object> CheckModelSource(string model) {
            try {
                using (var cts = new CancellationTokenSource(15000)) {
                    string root = "https://registry.ollama.ai/v2/library/" + model.Split(':')[0] + "/";
                    using (var manifest = await http.GetAsync(root + "manifests/" + model.Split(':')[1], cts.Token)) {
                        manifest.EnsureSuccessStatusCode();
                        var payload = J.Decode(await manifest.Content.ReadAsStringAsync());
                        var layer = J.Arr(J.Get(payload, "layers")).OrderByDescending(item => J.Num(item, "size")).FirstOrDefault();
                        string digest = J.Str(layer, "digest");
                        if (!digest.StartsWith("sha256:", StringComparison.Ordinal) || digest.Length != 71) throw new Exception("模型文件信息无效。");
                        using (var request = new HttpRequestMessage(HttpMethod.Head, root + "blobs/" + digest))
                        using (var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token)) {
                            response.EnsureSuccessStatusCode();
                            return J.Obj("ok", true, "message", model + " 模型文件可连接");
                        }
                    }
                }
            } catch (Exception error) { return J.Obj("ok", false, "message", "模型下载源不可用：" + error.Message); }
        }
        private async Task InstallLocalRuntime(CancellationToken token) {
            if (File.Exists(LocalOllamaExe)) return;
            if (Directory.Exists(LocalRuntime)) throw new Exception("运行环境目录已存在但缺少 ollama.exe，请检查 " + LocalRuntime);
            Directory.CreateDirectory(LocalModelRoot);
            ReportLocalModel("runtime", "正在查询 Ollama 官方 Windows 运行环境…");
            object release;
            using (var response = await http.GetAsync("https://api.github.com/repos/ollama/ollama/releases/latest", token)) {
                response.EnsureSuccessStatusCode();
                release = J.Decode(await response.Content.ReadAsStringAsync());
            }
            var asset = J.Arr(J.Get(release, "assets")).FirstOrDefault(item => J.Str(item, "name") == "ollama-windows-amd64.zip");
            if (asset == null) throw new Exception("官方发布中没有 Windows x64 运行环境。");
            string url = J.Str(asset, "browser_download_url"), digest = J.Str(asset, "digest");
            Uri address;
            if (!Uri.TryCreate(url, UriKind.Absolute, out address) || address.Scheme != "https" || address.Host != "github.com" || !address.AbsolutePath.Contains("/ollama/ollama/releases/download/") || !digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase)) throw new Exception("官方运行环境下载信息无效。");
            long size = (long)J.Num(asset, "size");
            if (new DriveInfo(Path.GetPathRoot(LocalModelRoot)).AvailableFreeSpace < Math.Max(size * 4, 7L * 1024 * 1024 * 1024)) throw new Exception("E 盘空间不足，运行环境需要至少 7 GB 可用空间。");
            string archive = Path.Combine(LocalModelRoot, "ollama-windows-amd64.zip");
            string stage = Path.Combine(LocalModelRoot, "runtime-stage-" + Guid.NewGuid().ToString("N"));
            try {
                using (var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token)) {
                    response.EnsureSuccessStatusCode();
                    long total = response.Content.Headers.ContentLength ?? size, completed = 0;
                    using (var input = await response.Content.ReadAsStreamAsync())
                    using (var output = new FileStream(archive, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 1024, true)) {
                        var buffer = new byte[1024 * 1024]; int count;
                        while ((count = await input.ReadAsync(buffer, 0, buffer.Length, token)) > 0) {
                            await output.WriteAsync(buffer, 0, count, token); completed += count;
                            if (completed == count || completed % (16 * 1024 * 1024) < count) ReportLocalModel("runtime", "正在下载运行环境", completed, total);
                        }
                    }
                }
                ReportLocalModel("verify", "正在校验官方文件…");
                string hash = await Task.Run(() => { using (var sha = SHA256.Create()) using (var file = File.OpenRead(archive)) return BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "").ToLowerInvariant(); }, token);
                if (!hash.Equals(digest.Substring(7), StringComparison.OrdinalIgnoreCase)) throw new Exception("运行环境校验失败，请重试下载。");
                ReportLocalModel("extract", "正在解压运行环境到 E 盘…");
                await Task.Run(() => {
                    Directory.CreateDirectory(stage);
                    string root = Path.GetFullPath(stage).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                    using (var zip = ZipFile.OpenRead(archive)) foreach (var entry in zip.Entries) {
                        token.ThrowIfCancellationRequested();
                        string target = Path.GetFullPath(Path.Combine(stage, entry.FullName));
                        if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new IOException("运行环境压缩包包含无效路径。");
                        if (entry.Name.Length == 0) Directory.CreateDirectory(target);
                        else { Directory.CreateDirectory(Path.GetDirectoryName(target)); entry.ExtractToFile(target); }
                    }
                }, token);
                if (!File.Exists(Path.Combine(stage, "ollama.exe"))) throw new Exception("运行环境解压后缺少 ollama.exe。");
                Directory.Move(stage, LocalRuntime);
            } finally {
                if (File.Exists(archive)) File.Delete(archive);
                if (Directory.Exists(stage)) Directory.Delete(stage, true);
            }
        }
        private async Task StartLocalModelServer() {
            await localStartGate.WaitAsync();
            try {
            if (!File.Exists(LocalOllamaExe)) throw new Exception("请先下载本地运行环境。");
            if (localModelServer != null && !localModelServer.HasExited && J.Bool(await LocalModelStatus(), "running")) return;
            Directory.CreateDirectory(LocalModelsPath);
            var info = new ProcessStartInfo(LocalOllamaExe, "serve") { WorkingDirectory = LocalRuntime, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            info.EnvironmentVariables["OLLAMA_MODELS"] = LocalModelsPath;
            info.EnvironmentVariables["OLLAMA_HOST"] = "127.0.0.1:11435";
            info.EnvironmentVariables["OLLAMA_NO_CLOUD"] = "1";
            info.EnvironmentVariables["OLLAMA_NUM_PARALLEL"] = "1";
            info.EnvironmentVariables["OLLAMA_TMPDIR"] = Path.Combine(LocalModelRoot, "temp");
            Directory.CreateDirectory(info.EnvironmentVariables["OLLAMA_TMPDIR"]);
            if (J.Bool(await LocalModelStatus(), "running")) throw new Exception("11435 端口已有其他服务，请先关闭该服务。");
            localModelServer = Process.Start(info);
            if (localModelServer == null) throw new Exception("无法启动 Ollama 本地服务。");
            localModelServer.OutputDataReceived += (s, e) => { if (e.Data != null) Log("local-model " + e.Data); };
            localModelServer.ErrorDataReceived += (s, e) => { if (e.Data != null) Log("local-model " + e.Data); };
            localModelServer.BeginOutputReadLine(); localModelServer.BeginErrorReadLine();
            for (int attempt = 0; attempt < 30; attempt++) {
                if (localModelServer.HasExited) throw new Exception("Ollama 本地服务启动失败，请查看启动日志。");
                if (J.Bool(await LocalModelStatus(), "running")) return;
                await Task.Delay(500);
            }
            throw new Exception("Ollama 本地服务启动超时，请查看启动日志。");
            } finally { localStartGate.Release(); }
        }
        private async Task PullLocalModel(string model, CancellationToken token) {
            long modelBytes = model.EndsWith(":70b") ? 43L * 1024 * 1024 * 1024
                : model == "qwen3.5:4b" ? 4L * 1024 * 1024 * 1024
                : model == "qwen3.5:9b" ? 8L * 1024 * 1024 * 1024
                : model.EndsWith(":32b") ? 20L * 1024 * 1024 * 1024
                : model.EndsWith(":14b") ? 9L * 1024 * 1024 * 1024
                : model.EndsWith(":7b") ? 5L * 1024 * 1024 * 1024 : 2L * 1024 * 1024 * 1024;
            if (new DriveInfo(Path.GetPathRoot(LocalModelRoot)).AvailableFreeSpace < modelBytes) throw new Exception("模型下载所需空间不足，请清理安装磁盘后重试。");
            for (int attempt = 0; attempt < 3; attempt++) {
                token.ThrowIfCancellationRequested();
                ReportLocalModel("model", attempt == 0 ? "正在下载 " + model + "…" : "连接中断，正在续传 " + model + "（" + (attempt + 1) + "/3）…");
                bool retry = false;
                try {
                    using (var request = new HttpRequestMessage(HttpMethod.Post, LocalModelHost + "/api/pull")) {
                        request.Content = new StringContent(J.Encode(J.Obj("name", model, "stream", true)), Encoding.UTF8, "application/json");
                        using (var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token)) {
                            response.EnsureSuccessStatusCode();
                            using (token.Register(() => response.Dispose()))
                            using (var reader = new StreamReader(await response.Content.ReadAsStreamAsync())) {
                                string line;
                                while ((line = await reader.ReadLineAsync()) != null) {
                                    token.ThrowIfCancellationRequested();
                                    var progress = J.Decode(line);
                                    string error = J.Str(progress, "error"); if (error.Length > 0) throw new Exception("模型下载失败：" + error);
                                    ReportLocalModel("model", J.Str(progress, "status", "正在下载 " + model), (long)J.Num(progress, "completed"), (long)J.Num(progress, "total"));
                                }
                            }
                        }
                    }
                } catch (Exception error) {
                    if (token.IsCancellationRequested) throw new OperationCanceledException(token);
                    if (attempt == 2 || !IsRetryableModelDownload(error)) throw;
                    retry = true;
                }
                if (retry) { await Task.Delay(TimeSpan.FromSeconds(3 * (attempt + 1)), token); continue; }
                break;
            }
            var status = await LocalModelStatus();
            if (!J.Arr(J.Get(status, "models")).OfType<string>().Contains(model, StringComparer.Ordinal)) throw new Exception("下载结束后没有检测到模型，请重试。");
        }
        private static bool IsRetryableModelDownload(Exception error) {
            if (error is IOException || error is HttpRequestException) return true;
            return error.Message.IndexOf("EOF", StringComparison.OrdinalIgnoreCase) >= 0
                || error.Message.IndexOf("timeout", StringComparison.OrdinalIgnoreCase) >= 0
                || error.Message.IndexOf("connection reset", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        private async Task StopLocalModelServer() {
            await localStartGate.WaitAsync();
            try {
                if (localModelCancel != null) throw new Exception("请先取消当前模型下载，再停止本地服务。");
                if (localModelServer == null) {
                    if (J.Bool(await LocalModelStatus(), "running")) throw new Exception("本地服务不是由剪辑台启动，请在启动它的程序中停止。");
                    return;
                }
                if (!localModelServer.HasExited) {
                    localModelServer.Kill();
                    if (!localModelServer.WaitForExit(5000)) throw new Exception("本地服务未能在 5 秒内停止。");
                }
                localModelServer.Dispose();
                localModelServer = null;
            } finally { localStartGate.Release(); }
        }
        private void StopLocalModels() {
            if (localModelCancel != null) localModelCancel.Cancel();
            try { if (localModelServer != null && !localModelServer.HasExited) localModelServer.Kill(); } catch { }
            if (localModelServer != null) localModelServer.Dispose();
            localModelServer = null;
        }
    }
}
