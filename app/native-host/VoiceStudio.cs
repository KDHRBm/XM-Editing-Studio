using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Text.RegularExpressions;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private readonly SemaphoreSlim voiceGate = new SemaphoreSlim(1, 1);
        private CancellationTokenSource voiceCancel;
        private object voiceProgress = J.Obj("stage", "idle", "message", "");
        private string VoiceRoot { get { return Path.Combine(DataDir, "voxcpm"); } }
        private string VoiceScripts { get { return Path.Combine(BaseDir, "resources", "voxcpm"); } }
        private string VoicePython { get { return Path.Combine(VoiceRoot, "runtime", "Scripts", "python.exe"); } }
        private bool VoiceRuntimeReady { get { return File.Exists(VoicePython) && J.Str(J.Read(Path.Combine(VoiceRoot, "runtime-ready.json"), null), "version") == "2.0.3"; } }
        private bool VoiceModelReady {
            get {
                var record = J.Read(Path.Combine(VoiceRoot, "model-ready.json"), null);
                var files = J.Arr(J.Get(record, "files"));
                if (J.Str(record, "model") != "OpenBMB/VoxCPM2" || files.Length < 5) return false;
                try { return files.All(item => { var f = new FileInfo(J.Under(Path.Combine(VoiceRoot, "models", "VoxCPM2"), J.Str(item, "Path"))); return f.Exists && f.Length == (long)J.Num(item, "Size"); }); }
                catch { return false; }
            }
        }
        private object VoiceStatus() {
            string folder = Path.Combine(VoiceRoot, "outputs");
            object[] results = Directory.Exists(folder) ? Directory.GetFiles(folder, "*.json").OrderByDescending(x => x).Take(30).Select(x => J.Read(x, null)).Where(x => x != null && Regex.IsMatch(J.Str(x, "id"), @"^\d{8}-\d{6}-[a-f0-9]{8}$") && File.Exists(Path.Combine(folder, J.Str(x, "id") + ".wav"))).ToArray() : new object[0];
            return J.Obj("root", VoiceRoot, "runtimeReady", VoiceRuntimeReady, "modelReady", VoiceModelReady, "busy", voiceGate.CurrentCount == 0, "progress", voiceProgress, "results", results);
        }
        private void VoiceReport(object progress) {
            voiceProgress = progress;
            Ui(() => Emit("bos:voice-progress", progress));
        }
        private void StopVoice() { var token = voiceCancel; if (token != null) try { token.Cancel(); } catch (ObjectDisposedException) {} }
        private string VoiceOutput(string id) {
            if (!Regex.IsMatch(id ?? "", @"^\d{8}-\d{6}-[a-f0-9]{8}$")) throw new Exception("无效的音频编号。");
            string file = J.Under(Path.Combine(VoiceRoot, "outputs"), id + ".wav");
            ValidatePathChain(file);
            if (!File.Exists(file)) throw new Exception("生成的音频文件不存在。");
            return file;
        }
        private async Task<object> VoiceAction(string action, object value) {
            if (action == "status") return VoiceStatus();
            if (action == "cancel") { StopVoice(); return VoiceStatus(); }
            if (action == "choose-reference") { var files = ChooseFiles("参考音频（0.5–30 秒）|*.wav;*.flac;*.mp3;*.ogg"); return J.Obj("path", files.FirstOrDefault() ?? ""); }
            if (action == "open-directory") { string folder = Path.Combine(VoiceRoot, "outputs"); Directory.CreateDirectory(folder); Process.Start(new ProcessStartInfo(folder) { UseShellExecute = true }); return VoiceStatus(); }
            if (action == "export") {
                string source = VoiceOutput(J.Str(value, "id"));
                using (var dialog = new SaveFileDialog { Filter = "WAV 音频|*.wav", FileName = "配音-" + Path.GetFileName(source), OverwritePrompt = true }) {
                    if (dialog.ShowDialog(MainWindow) == DialogResult.OK && !Path.GetFullPath(dialog.FileName).Equals(source, StringComparison.OrdinalIgnoreCase)) File.Copy(source, dialog.FileName, true);
                }
                return VoiceStatus();
            }
            if (!new[] { "install", "generate", "transcribe" }.Contains(action)) throw new Exception("不支持的音频克隆操作。");
            if (!voiceGate.Wait(0)) throw new Exception("音频克隆正在处理其他任务，请先等待完成或停止。");
            var cts = new CancellationTokenSource(TimeSpan.FromHours(2)); voiceCancel = cts;
            try {
                Directory.CreateDirectory(VoiceRoot);
                if (action == "install") {
                    if (new DriveInfo(Path.GetPathRoot(VoiceRoot)).AvailableFreeSpace < 18L * 1024 * 1024 * 1024) throw new Exception("首次部署建议至少保留 18GB 空间（包含下载缓存与运行环境）。");
                    if (!VoiceRuntimeReady) await RunVoiceProcess(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"), "-NoProfile -ExecutionPolicy Bypass -File " + J.Quote(Path.Combine(VoiceScripts, "setup.ps1")) + " -Root " + J.Quote(VoiceRoot), cts.Token);
                    if (!VoiceRuntimeReady) throw new Exception("运行环境尚未安装完成，请重试。");
                    await RunVoiceProcess(VoicePython, J.Quote(Path.Combine(VoiceScripts, "worker.py")) + " --root " + J.Quote(VoiceRoot) + " --action install-model", cts.Token);
                    if (!VoiceModelReady) throw new Exception("模型校验未通过，请重新下载安装。");
                } else {
                    if (!VoiceRuntimeReady || !VoiceModelReady) throw new Exception("请先点击“下载安装模型”完成本地部署。");
                    string jobs = Path.Combine(VoiceRoot, "jobs"); Directory.CreateDirectory(jobs);
                    string request = Path.Combine(jobs, Guid.NewGuid().ToString("N") + ".json");
                    J.Save(request, value);
                    try { await RunVoiceProcess(VoicePython, J.Quote(Path.Combine(VoiceScripts, "worker.py")) + " --root " + J.Quote(VoiceRoot) + " --action " + action + " --request " + J.Quote(request), cts.Token); }
                    finally { if (File.Exists(request)) File.Delete(request); }
                }
            } catch (OperationCanceledException) { VoiceReport(J.Obj("stage", "cancelled", "message", "已停止。已完成音频保留，模型下载可继续。")); }
            catch (Exception error) { VoiceReport(J.Obj("stage", "error", "message", error.Message)); throw; }
            finally { voiceCancel = null; cts.Dispose(); voiceGate.Release(); }
            return VoiceStatus();
        }
        private async Task RunVoiceProcess(string exe, string args, CancellationToken token) {
            token.ThrowIfCancellationRequested();
            if (!File.Exists(exe)) throw new Exception("缺少语音运行文件，请重新部署。");
            VoiceReport(J.Obj("stage", "starting", "message", "正在准备音频克隆…"));
            var info = new ProcessStartInfo(exe, args) { WorkingDirectory = VoiceRoot, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
            info.EnvironmentVariables["PYTHONUTF8"] = "1"; info.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8"; info.EnvironmentVariables["PYTHONNOUSERSITE"] = "1";
            info.EnvironmentVariables["PYTHONUNBUFFERED"] = "1";
            string temp = Path.Combine(VoiceRoot, "temp"); Directory.CreateDirectory(temp);
            info.EnvironmentVariables["TEMP"] = temp; info.EnvironmentVariables["TMP"] = temp;
            string logPath = Path.Combine(VoiceRoot, "deployment.log");
            if (File.Exists(logPath) && new FileInfo(logPath).Length > 4 * 1024 * 1024) File.Move(logPath, logPath + "." + Guid.NewGuid().ToString("N") + ".old");
            using (var process = new Process { StartInfo = info }) using (var log = new StreamWriter(logPath, true, Encoding.UTF8) { AutoFlush = true }) {
                object logGate = new object(); string lastError = "";
                DataReceivedEventHandler output = (s, e) => {
                    if (e.Data == null) return;
                    lock (logGate) { log.WriteLine(e.Data); }
                    if (e.Data.StartsWith("@XMVOX@")) try {
                        var progress = J.Decode(e.Data.Substring(7));
                        if (J.Str(progress, "stage") == "error") lastError = J.Str(progress, "message");
                        VoiceReport(progress);
                    } catch {}
                };
                process.OutputDataReceived += output; process.ErrorDataReceived += output;
                process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
                using (token.Register(() => {
                    try { if (!process.HasExited) using (var kill = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + process.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true })) { kill.WaitForExit(5000); } } catch {}
                })) {
                    await Task.Run(() => process.WaitForExit());
                    token.ThrowIfCancellationRequested();
                    if (process.ExitCode != 0) throw new Exception(lastError.Length > 0 ? lastError : "音频克隆运行失败，请查看 " + logPath);
                }
            }
        }
    }
}
