using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
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
            object inventory = await Task.Run(() => LocalModelInventory.Read(LocalModelsPath));
            object[] details = J.Arr(J.Get(inventory, "models"));
            object[] models = details.Where(item => J.Bool(item, "complete")).Select(item => (object)J.Str(item, "name")).ToArray();
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
            object hardware = localHardware ?? (localHardware = await Task.Run(() => DetectLocalHardware()));
            return J.Obj("runtimeInstalled", File.Exists(LocalOllamaExe), "running", running,
                "models", models, "modelDetails", details, "modelStorageBytes", J.Get(inventory, "bytes"), "modelWarning", J.Get(inventory, "warning"),
                "modelsPath", LocalModelsPath, "analysisActive", LocalInferenceActive, "root", LocalModelRoot, "endpoint", LocalModelHost + "/v1",
                "progress", localModelProgress, "hardware", hardware, "acceleration", await LocalAccelerationStatus(running, hardware));
        }
        private async Task<object> LocalModelAction(string action, string model, object settings = null) {
            if (action == "delete-model" || action == "unload-model" || action == "open-model-folder") return await ManageLocalModel(action, model, settings);
            if (action == "acceleration") return await SaveLocalAcceleration(settings);
            if (action == "detect") { localHardware = null; return await LocalModelStatus(); }
            if (action == "status") return await LocalModelStatus();
            if (action == "sources") return await CheckLocalModelSources(LocalModelNames.Contains(model, StringComparer.Ordinal) ? model : "deepseek-r1:7b");
            if (action == "cancel") { if (localModelCancel != null) localModelCancel.Cancel(); return await LocalModelStatus(); }
            if (action == "start") { await StartLocalModelServer(); return await LocalModelStatus(); }
            if (action == "stop") { await StopLocalModelServer(); return await LocalModelStatus(); }
            if (action != "install-runtime" && action != "upgrade-runtime" && action != "pull") throw new Exception("无效的本地模型操作。");
            if (action == "pull" && !LocalModelNames.Contains(model, StringComparer.Ordinal)) throw new Exception("不支持此模型，请从列表中选择。");
            if (!await localModelGate.WaitAsync(0)) throw new Exception("已有本地模型下载任务正在进行。");
            using (var cts = new CancellationTokenSource()) {
                localModelCancel = cts;
                try {
                    if (action == "pull") {
                        await localStartGate.WaitAsync(cts.Token);
                        try {
                            if (!File.Exists(LocalOllamaExe)) {
                                if (J.Bool(await LocalModelStatus(), "running")) throw new Exception("11435 端口已有其他本地服务，请先关闭该服务再部署模型。");
                                await InstallLocalRuntime(cts.Token);
                            }
                        } finally { localStartGate.Release(); }
                        cts.Token.ThrowIfCancellationRequested();
                        await StartLocalModelServer(cts.Token);
                        await PullLocalModel(model, cts.Token);
                    }
                    else {
                        await localStartGate.WaitAsync(cts.Token);
                        try {
                            if (J.Bool(await LocalModelStatus(), "running")) throw new Exception("请先等本地分析完成并停止本地服务，再更新运行环境。");
                            await InstallLocalRuntime(cts.Token, action == "upgrade-runtime");
                        } finally { localStartGate.Release(); }
                    }
                    ReportLocalModel("done", action == "pull" ? model + " 已下载，可以加入分析模型。" : "本地运行环境已安装；已下载的模型保留。");
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
                var asset = await LocalRuntimeDownload.GetAsset(http, CancellationToken.None);
                string source = await LocalRuntimeDownload.Probe(http, asset, CancellationToken.None);
                return J.Obj("ok", true, "source", source, "message", "Windows 运行环境文件可连接（" + source + "，安装时校验官方 SHA-256）");
            } catch (Exception error) {
                bool timeout = error is TimeoutException || error is OperationCanceledException;
                string message = timeout ? "运行环境下载源检测超时，尚不能确认是否可用。请稍后重试。" : "运行环境下载源暂时无法连接：" + error.Message;
                if (File.Exists(LocalOllamaExe)) message += " 已安装的运行环境仍可使用，无需重新下载。";
                Log("local-runtime-source " + (timeout ? "timeout" : "failed") + " " + LocalModelNetwork.RedactLog(error.Message));
                return J.Obj("ok", false, "status", timeout ? "timeout" : "unavailable", "message", message);
            }
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
            } catch (OperationCanceledException) { return J.Obj("ok", false, "status", "timeout", "message", model + " 模型下载源检测超时，尚不能确认是否可用，请稍后重试。"); }
            catch (Exception error) { return J.Obj("ok", false, "message", "模型下载源暂时无法连接：" + LocalModelNetwork.RedactLog(error.Message)); }
        }
        private async Task InstallLocalRuntime(CancellationToken token, bool upgrade = false) {
            if (File.Exists(LocalOllamaExe) && !upgrade) return;
            if (Directory.Exists(LocalRuntime) && !upgrade) throw new Exception("运行环境目录已存在但缺少 ollama.exe，请更新运行环境修复 " + LocalRuntime);
            Directory.CreateDirectory(LocalModelRoot);
            ReportLocalModel("runtime", "正在查询 Ollama 官方 Windows 运行环境…");
            var asset = await LocalRuntimeDownload.GetAsset(http, token);
            long size = asset.Size;
            if (new DriveInfo(Path.GetPathRoot(LocalModelRoot)).AvailableFreeSpace < Math.Max(size * 4, 7L * 1024 * 1024 * 1024)) throw new Exception("E 盘空间不足，运行环境需要至少 7 GB 可用空间。");
            string archive = Path.Combine(LocalModelRoot, "ollama-windows-amd64.zip");
            string stage = Path.Combine(LocalModelRoot, "runtime-stage-" + Guid.NewGuid().ToString("N"));
            try {
                await LocalRuntimeDownload.Download(http, asset, archive, token, (phase, message, completed, total) => ReportLocalModel(phase, message, completed, total));
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
                token.ThrowIfCancellationRequested();
                string backup = Path.Combine(LocalModelRoot, "runtime-backup-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N"));
                bool previous = Directory.Exists(LocalRuntime);
                if (previous) Directory.Move(LocalRuntime, backup);
                try { Directory.Move(stage, LocalRuntime); }
                catch { if (previous && !Directory.Exists(LocalRuntime)) Directory.Move(backup, LocalRuntime); throw; }
            } finally {
                if (File.Exists(archive)) File.Delete(archive);
                if (Directory.Exists(stage)) Directory.Delete(stage, true);
            }
        }
        private async Task StartLocalModelServer(CancellationToken token = default(CancellationToken)) {
            await localStartGate.WaitAsync(token);
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
            await Task.Run(() => LocalModelNetwork.Configure(info));
            Directory.CreateDirectory(info.EnvironmentVariables["OLLAMA_TMPDIR"]);
            object acceleration = ReadLocalAcceleration();
            LocalAcceleration.Apply(info, acceleration, localHardware ?? (localHardware = await Task.Run(() => DetectLocalHardware())), LocalRuntime);
            if (J.Bool(await LocalModelStatus(), "running")) throw new Exception("11435 端口已有其他服务，请先关闭该服务。");
            localModelServer = Process.Start(info);
            if (localModelServer == null) throw new Exception("无法启动 Ollama 本地服务。");
            localAccelerationActive = acceleration;
            localModelServer.OutputDataReceived += (s, e) => { if (e.Data != null) Log("local-model " + LocalModelNetwork.RedactLog(e.Data)); };
            localModelServer.ErrorDataReceived += (s, e) => { if (e.Data != null) Log("local-model " + LocalModelNetwork.RedactLog(e.Data)); };
            localModelServer.BeginOutputReadLine(); localModelServer.BeginErrorReadLine();
            for (int attempt = 0; attempt < 30; attempt++) {
                if (localModelServer.HasExited) throw new Exception("Ollama 本地服务启动失败，请查看启动日志。");
                if (J.Bool(await LocalModelStatus(), "running")) return;
                await Task.Delay(500, token);
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
                                    string error = J.Str(progress, "error"); if (error.Length > 0) throw new Exception(LocalModelNetwork.DownloadError(error));
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
                if (LocalInferenceActive) throw new Exception("本地模型正在分析，请等待分析完成再停止服务。");
                lock (localInferenceSync) if (localModelMutating) throw new Exception("模型管理操作正在进行，请完成后再停止服务。");
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
                localAccelerationActive = null;
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
