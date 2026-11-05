using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Windows.Forms;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private Dictionary<string, object> updater = J.Obj("status", "idle", "currentVersion", Version, "latestVersion", Version, "hasUpdate", false, "progress", 0, "error", "", "sideBySide", false);
        private Task<object> updateTask;
        private bool startupUpdateChecked;
        private readonly CancellationTokenSource updateClosing = new CancellationTokenSource();
        private object UpdateState(params object[] pairs) { foreach (var item in J.Obj(pairs)) updater[item.Key] = item.Value; Emit("bos:updater-state", updater); return updater; }
        internal static int CompareVersion(string a, string b) { System.Version x, y; if (!System.Version.TryParse(a.TrimStart('v', 'V').Split('-')[0], out x)) x = new System.Version(0, 0); if (!System.Version.TryParse(b.TrimStart('v', 'V').Split('-')[0], out y)) y = new System.Version(0, 0); return x.CompareTo(y); }
        private async Task<object> GetRelease(string repo) {
            using (var cts = CancellationTokenSource.CreateLinkedTokenSource(updateClosing.Token)) { cts.CancelAfter(25000);
                using (var response = await http.GetAsync("https://api.github.com/repos/" + repo + "/releases/latest", cts.Token)) { response.EnsureSuccessStatusCode(); return J.Decode(await response.Content.ReadAsStringAsync()); }
            }
        }
        private static string ReleaseUrl(string value, string repo) { if (!value.StartsWith("https://github.com/" + repo + "/releases/", StringComparison.Ordinal)) throw new Exception("更新包地址不属于本软件的发布仓库。"); return value; }
        private async Task DownloadVerified(string url, string dest, string expected, long size, Action<int> progress) {
            if (!Regex.IsMatch(expected ?? "", "^[a-fA-F0-9]{64}$")) throw new Exception("发布包缺少 SHA-256 校验，已取消下载。");
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            if (File.Exists(dest) && J.FileHash(dest).Equals(expected, StringComparison.OrdinalIgnoreCase)) { progress(100); return; }
            var sources = new List<string>();
            if (url.StartsWith("https://github.com/", StringComparison.OrdinalIgnoreCase))
                sources.Add("https://gh-proxy.com/" + url);
            sources.Add(url);
            Exception lastError = null;
            foreach (string source in sources) {
                string temp = dest + "." + Guid.NewGuid().ToString("N") + ".part";
                try {
                    progress(0);
                    using (var cts = CancellationTokenSource.CreateLinkedTokenSource(updateClosing.Token)) { cts.CancelAfter(15 * 60000);
                        using (var response = await http.GetAsync(source, HttpCompletionOption.ResponseHeadersRead, cts.Token)) {
                            response.EnsureSuccessStatusCode(); long total = size > 0 ? size : response.Content.Headers.ContentLength ?? 0;
                            using (var input = await response.Content.ReadAsStreamAsync()) using (var output = new FileStream(temp, FileMode.CreateNew)) {
                                byte[] buffer = new byte[131072]; int count, percent = -1;
                                while ((count = await input.ReadAsync(buffer, 0, buffer.Length, cts.Token)) > 0) {
                                    if (output.Length + count > (size > 0 ? size : 2L * 1024 * 1024 * 1024)) throw new Exception("更新包大小异常。");
                                    await output.WriteAsync(buffer, 0, count, cts.Token); int next = total > 0 ? (int)Math.Min(99, output.Length * 100 / total) : 0;
                                    if (next != percent) { percent = next; progress(percent); }
                                }
                                if (size > 0 && output.Length != size) throw new Exception("更新包下载不完整。");
                            }
                        }
                    }
                    if (!J.FileHash(temp).Equals(expected, StringComparison.OrdinalIgnoreCase)) throw new Exception("更新包 SHA-256 校验不一致。");
                    if (File.Exists(dest)) File.Replace(temp, dest, dest + ".bak"); else File.Move(temp, dest);
                    progress(100); return;
                } catch (Exception error) {
                    if (updateClosing.IsCancellationRequested) throw;
                    lastError = error;
                } finally { if (File.Exists(temp)) File.Delete(temp); }
            }
            throw new Exception("国内节点和官方地址均下载失败：" + lastError.Message, lastError);
        }
        private async Task<object> UpdateAction(string action) {
            if (updateTask != null) return await updateTask;
            updateTask = UpdateCore(action); try { return await updateTask; } finally { updateTask = null; }
        }
        private async Task CheckStartupUpdate() {
            if (startupUpdateChecked || Exiting) return;
            startupUpdateChecked = true;
            await UpdateAction("check");
            Log("startup-update " + J.Str(updater, "status") + " source=" + WebsiteUpdates.Feed);
        }
        private async Task<object> UpdateCore(string action) {
            try {
                if (action == "check") {
                    UpdateState("status", "checking", "error", "", "hasUpdate", false); object package;
                    using (var cts = CancellationTokenSource.CreateLinkedTokenSource(updateClosing.Token)) { cts.CancelAfter(25000); package = await WebsiteUpdates.Check(http, Version, cts.Token); }
                    bool available = package != null;
                    return UpdateState("status", available ? "available" : "up-to-date", "latestVersion", available ? J.Str(package, "version") : Version, "hasUpdate", available, "releaseUrl", WebsiteUpdates.Site, "downloadUrl", J.Str(package, "url"), "assetName", J.Str(package, "name"), "expectedSha256", J.Str(package, "sha"), "assetSize", J.Num(package, "size"), "packageType", J.Str(package, "type"), "installerPath", "");
                }
                if (action != "download" && action != "install") throw new Exception("无效的更新操作。");
                if (!J.Bool(updater, "hasUpdate")) throw new Exception("请先检查是否有新版本。");
                string installer = J.Str(updater, "installerPath");
                if (installer.Length == 0 || !File.Exists(installer)) {
                    string name = J.Str(updater, "assetName"); if (name != Path.GetFileName(name) || !(J.Str(updater, "packageType") == "incremental" ? name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) : name.EndsWith("Setup.exe", StringComparison.OrdinalIgnoreCase))) throw new Exception("更新安装包名称无效。");
                    installer = J.Under(Path.Combine(DataDir, "updates"), name); UpdateState("status", "downloading", "progress", 0, "error", "");
                    await DownloadVerified(ReleaseUrl(J.Str(updater, "downloadUrl"), "KDHRBm/XM-Editing-Studio"), installer, J.Str(updater, "expectedSha256"), (long)J.Num(updater, "assetSize"), p => UpdateState("progress", p));
                    UpdateState("status", "ready", "installerPath", installer);
                }
                if (action == "install") {
                    if (J.FileHash(installer) != J.Str(updater, "expectedSha256").ToLowerInvariant()) throw new Exception("安装包在下载后发生改变，请重新下载。");
                    if (MessageBox.Show(MainWindow, "请先保存当前任务。继续将退出 XM剪辑台，并打开更新安装器。", "安装更新", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return updater;
                    if (J.Str(updater, "packageType") == "incremental") {
                        // Run outside the installation so the patch updater does not lock its target.
                        string parent = Path.Combine(Directory.GetParent(BaseDir.TrimEnd(Path.DirectorySeparatorChar)).FullName, ".xm-updates");
                        string patch = await Task.Run(() => WebsiteUpdates.PreparePatch(installer, parent, J.Str(updater, "latestVersion"), J.Str(updater, "expectedSha256")));
                        updateClosing.Token.ThrowIfCancellationRequested();
                        Process.Start(new ProcessStartInfo(patch, "--directory " + J.Quote(BaseDir)) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(patch) }); Quit(); return updater;
                    }
                    // The updater swaps data with its verified migration copy. A
                    // running EXE inside data/updates would lock that directory.
                    string launchDir = Path.Combine(BaseDir, ".xiaoma-update-launch");
                    Directory.CreateDirectory(launchDir);
                    string launch = J.Under(launchDir, Path.GetFileName(installer));
                    File.Copy(installer, launch, true);
                    if (J.FileHash(launch) != J.Str(updater, "expectedSha256").ToLowerInvariant()) throw new Exception("更新启动文件校验失败，请重试。");
                    Process.Start(new ProcessStartInfo(launch, "/D=" + BaseDir.TrimEnd(Path.DirectorySeparatorChar)) { UseShellExecute = true, WorkingDirectory = launchDir }); Quit();
                }
                return updater;
            } catch (Exception error) { return UpdateState("status", "error", "error", error.Message); }
        }

    }
}
