using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Collections.Generic;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private Dictionary<string, object> updater = J.Obj("status", "idle", "currentVersion", Version, "latestVersion", Version, "hasUpdate", false, "progress", 0, "error", "", "sideBySide", false);
        private Task<object> updateTask;
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
            string temp = dest + "." + Guid.NewGuid().ToString("N") + ".part";
            try {
                using (var cts = CancellationTokenSource.CreateLinkedTokenSource(updateClosing.Token)) { cts.CancelAfter(15 * 60000);
                    using (var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cts.Token)) {
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
                if (File.Exists(dest)) File.Replace(temp, dest, dest + ".bak"); else File.Move(temp, dest); progress(100);
            } finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        private async Task<object> UpdateAction(string action) {
            if (updateTask != null) return await updateTask;
            updateTask = UpdateCore(action); try { return await updateTask; } finally { updateTask = null; }
        }
        private async Task<object> UpdateCore(string action) {
            try {
                if (action == "check") {
                    UpdateState("status", "checking", "error", ""); var release = await GetRelease("KDHRBm/XM-Editing-Studio");
                    string version = J.Str(release, "tag_name", Version).TrimStart('v', 'V');
                    var assets = J.Arr(J.Get(release, "assets")); object setup = assets.FirstOrDefault(x => Regex.IsMatch(J.Str(x, "name"), @"Setup\.exe$", RegexOptions.IgnoreCase));
                    string hash = J.Str(setup, "digest"); hash = hash.StartsWith("sha256:") ? hash.Substring(7) : "";
                    object sums = assets.FirstOrDefault(x => J.Str(x, "name") == "SHA256SUMS.txt");
                    if (hash.Length == 0 && sums != null && setup != null) { var text = await http.GetStringAsync(ReleaseUrl(J.Str(sums, "browser_download_url"), "KDHRBm/XM-Editing-Studio")); foreach (string line in text.Split('\n')) { var match = Regex.Match(line.Trim(), @"^([a-fA-F0-9]{64})\s+\*?(.+)$"); if (match.Success && match.Groups[2].Value.Trim() == J.Str(setup, "name")) hash = match.Groups[1].Value; } }
                    bool available = CompareVersion(version, Version) > 0 && setup != null;
                    return UpdateState("status", available ? "available" : "up-to-date", "latestVersion", version, "hasUpdate", available, "releaseUrl", J.Str(release, "html_url"), "downloadUrl", J.Str(setup, "browser_download_url"), "assetName", J.Str(setup, "name"), "expectedSha256", hash, "assetSize", J.Num(setup, "size"), "installerPath", "");
                }
                if (action != "download" && action != "install") throw new Exception("无效的更新操作。");
                if (!J.Bool(updater, "hasUpdate")) throw new Exception("请先检查是否有新版本。");
                string installer = J.Str(updater, "installerPath");
                if (installer.Length == 0 || !File.Exists(installer)) {
                    string name = J.Str(updater, "assetName"); if (name != Path.GetFileName(name) || !name.EndsWith("Setup.exe", StringComparison.OrdinalIgnoreCase)) throw new Exception("更新安装包名称无效。");
                    installer = J.Under(Path.Combine(DataDir, "updates"), name); UpdateState("status", "downloading", "progress", 0, "error", "");
                    await DownloadVerified(ReleaseUrl(J.Str(updater, "downloadUrl"), "KDHRBm/XM-Editing-Studio"), installer, J.Str(updater, "expectedSha256"), (long)J.Num(updater, "assetSize"), p => UpdateState("progress", p));
                    UpdateState("status", "ready", "installerPath", installer);
                }
                if (action == "install") {
                    if (J.FileHash(installer) != J.Str(updater, "expectedSha256").ToLowerInvariant()) throw new Exception("安装包在下载后发生改变，请重新下载。");
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

        private Dictionary<string, object> petUpdate = J.Obj("status", "idle", "currentVersion", "", "latestVersion", "", "progress", 0, "hasUpdate", false, "error", "");
        private object petRelease;
        private Task petUpdateTask;
        private string PetUpdateRoot { get { return Path.Combine(DataDir, "companion-updates"); } }
        private string BasePet { get { return Path.Combine(BaseDir, "resources", "companion"); } }
        private object PetUpdateState(params object[] pairs) { foreach (var pair in J.Obj(pairs)) petUpdate[pair.Key] = pair.Value; return petUpdate; }
        private bool ValidPetDirectory(string directory) { if (string.IsNullOrEmpty(directory)) return false; directory = Path.GetFullPath(directory); return directory.Equals(BasePet, StringComparison.OrdinalIgnoreCase) || Path.GetDirectoryName(directory).Equals(PetUpdateRoot, StringComparison.OrdinalIgnoreCase) && Regex.IsMatch(Path.GetFileName(directory), @"^runtime-[\w.-]+$"); }
        private object VerifyPet(string directory) {
            if (!ValidPetDirectory(directory)) throw new Exception("桌宠更新目录无效。");
            var manifest = J.Read(Path.Combine(directory, "xm-manifest.json"), null);
            foreach (var pair in new[] { new[] { "dsh-pet-standalone-webm-chat.exe", "executableSha256" }, new[] { "_internal/xm_companion_bridge.py", "bridgeSha256" }, new[] { "_internal/xm_companion_prepare.py", "prepareSha256" } }) {
                if (J.Str(manifest, pair[1]).Length != 64 || J.FileHash(J.Under(directory, pair[0])) != J.Str(manifest, pair[1])) throw new Exception("桌宠组件校验失败。");
            }
            return manifest;
        }
        private static void CopyTree(string source, string destination) {
            Directory.CreateDirectory(destination);
            foreach (string file in Directory.GetFiles(source)) File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), false);
            foreach (string child in Directory.GetDirectories(source)) { if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) != 0) throw new Exception("桌宠配置包含目录链接，无法自动备份。"); CopyTree(child, Path.Combine(destination, Path.GetFileName(child))); }
        }
        private void RestorePetConfig(object tx) {
            string backup = J.Str(tx, "backup"); if (!ValidPetDirectory(J.Str(tx, "previous")) || !Path.GetDirectoryName(backup).Equals(PetUpdateRoot, StringComparison.OrdinalIgnoreCase) || !Path.GetFileName(backup).StartsWith("backup-")) throw new Exception("桌宠恢复记录无效。");
            string cfg = Path.Combine(DataDir, "desktop-pet");
            if (Directory.Exists(cfg)) Directory.Move(cfg, Path.Combine(PetUpdateRoot, "failed-profile-" + Guid.NewGuid().ToString("N")));
            if (J.Bool(tx, "hadConfig")) CopyTree(Path.Combine(backup, "desktop-pet"), cfg);
            J.Save(Path.Combine(PetUpdateRoot, "active.json"), J.Obj("directory", J.Str(tx, "previous")));
        }
        private void InitPetUpdate() {
            Directory.CreateDirectory(PetUpdateRoot);
            try {
                string journal = Path.Combine(PetUpdateRoot, "transaction.json");
                if (File.Exists(journal)) { RestorePetConfig(J.Read(journal, null)); File.Delete(journal); petUpdate["error"] = "上次桌宠更新未完成，已恢复原组件和设置。"; }
                string selected = J.Str(J.Read(Path.Combine(PetUpdateRoot, "active.json"), null), "directory");
                if (selected.Length > 0) { VerifyPet(selected); pet.SetDirectory(selected); }
            } catch (Exception error) { petUpdate["error"] = error.Message + " 已使用随软件安装的桌宠。"; }
            petUpdate["currentVersion"] = J.Str(VerifyPet(pet.DirectoryPath), "version");
        }
        private async Task CheckPetUpdate() {
            if (petUpdateTask != null) { await petUpdateTask; return; } petUpdateTask = CheckPetUpdateCore(); try { await petUpdateTask; } finally { petUpdateTask = null; }
        }
        private async Task CheckPetUpdateCore() {
            try {
                PetUpdateState("status", "checking", "error", ""); object release;
                try { release = await GetRelease("MerZlin/dsh-pet-indesktop"); }
                catch { if (CompareVersion("4.4.0", J.Str(petUpdate, "currentVersion")) <= 0) throw;
                    petRelease = J.Obj("version", "4.4.0", "url", "https://github.com/MerZlin/dsh-pet-indesktop/releases/download/v4.4.0/dsh-pet-standalone-webm-chat-portable.zip", "size", 349295546, "sha256", "3f31b8c9454702d114e539324137347ad3a0c7c264d8071e29b250becdc59ea6");
                    PetUpdateState("status", "available", "latestVersion", "4.4.0", "hasUpdate", true, "size", 349295546, "error", "在线检查暂不可用，可安装已验证的 4.4.0 版本。"); return;
                }
                string version = J.Str(release, "tag_name").TrimStart('v'); object asset = J.Arr(J.Get(release, "assets")).FirstOrDefault(x => J.Str(x, "name") == "dsh-pet-standalone-webm-chat-portable.zip");
                if (J.Bool(release, "prerelease") || J.Bool(release, "draft") || !Regex.IsMatch(version, @"^\d+\.\d+\.\d+$") || !Regex.IsMatch(J.Str(asset, "digest"), "^sha256:[a-fA-F0-9]{64}$") || J.Num(asset, "size") <= 0 || J.Num(asset, "size") > 2L * 1024 * 1024 * 1024) throw new Exception("未找到带校验信息的正式桌宠更新包。");
                string url = "https://github.com/MerZlin/dsh-pet-indesktop/releases/download/v" + version + "/dsh-pet-standalone-webm-chat-portable.zip";
                if (J.Str(asset, "browser_download_url") != url) throw new Exception("桌宠下载地址无效。");
                petRelease = J.Obj("version", version, "url", url, "size", J.Num(asset, "size"), "sha256", J.Str(asset, "digest").Substring(7).ToLowerInvariant());
                bool available = CompareVersion(version, J.Str(petUpdate, "currentVersion")) > 0;
                PetUpdateState("status", available ? "available" : "up-to-date", "latestVersion", version, "hasUpdate", available, "size", J.Num(asset, "size"));
            } catch (Exception error) { PetUpdateState("status", "error", "error", error.Message); }
        }
        private async Task InstallPetUpdate() {
            if (petUpdateTask != null) { await petUpdateTask; return; } petUpdateTask = InstallPetUpdateCore(); try { await petUpdateTask; } finally { petUpdateTask = null; }
        }
        private async Task InstallPetUpdateCore() {
            object transaction = null; PetRuntime probe = null; string previous = pet.DirectoryPath; bool running = pet.Running, visible = pet.Visible; Exception failure = null;
            try {
                if (petRelease == null || !J.Bool(petUpdate, "hasUpdate")) throw new Exception("请先检查桌宠更新。");
                string version = J.Str(petRelease, "version"), candidate = Path.Combine(PetUpdateRoot, "runtime-" + version + "-" + Guid.NewGuid().ToString("N"));
                string archive = Path.Combine(PetUpdateRoot, "download-" + version + ".zip");
                PetUpdateState("status", "downloading", "error", "", "progress", 0);
                await DownloadVerified(J.Str(petRelease, "url"), archive, J.Str(petRelease, "sha256"), (long)J.Num(petRelease, "size"), p => PetUpdateState("progress", p));
                updateClosing.Token.ThrowIfCancellationRequested(); PetUpdateState("status", "preparing"); VerifyPet(BasePet);
                string request = Path.Combine(PetUpdateRoot, "prepare-" + Guid.NewGuid().ToString("N") + ".json"); J.Save(request, J.Obj("archive", archive, "destination", candidate, "previous", previous, "version", version, "sha256", J.Str(petRelease, "sha256")));
                var info = new ProcessStartInfo(Path.Combine(BasePet, "dsh-pet-standalone-webm-chat.exe"), "--xm-prepare-update " + J.Quote(request)) { WorkingDirectory = BasePet, UseShellExecute = false, CreateNoWindow = true }; info.EnvironmentVariables["XM_COMPANION_DATA"] = PetUpdateRoot;
                using (var process = Process.Start(info)) { if (!await Task.Run(() => process.WaitForExit(240000))) { process.Kill(); throw new Exception("桌宠更新准备超时。"); } if (process.ExitCode != 0) throw new Exception("桌宠更新适配失败，原版未替换。"); }
                VerifyPet(candidate); updateClosing.Token.ThrowIfCancellationRequested(); PetUpdateState("status", "testing");
                probe = new PetRuntime(candidate, Path.Combine(PetUpdateRoot, "probe-" + Guid.NewGuid().ToString("N"))); var tested = await probe.Start();
                if (!J.Bool(tested, "ready") || J.Str(tested, "version") != version) throw new Exception("新版桌宠启动验证失败。");
                await probe.Stop(); probe = null; updateClosing.Token.ThrowIfCancellationRequested(); PetUpdateState("status", "installing"); await pet.Stop();
                string backup = Path.Combine(PetUpdateRoot, "backup-" + Guid.NewGuid().ToString("N")), cfg = Path.Combine(DataDir, "desktop-pet"); Directory.CreateDirectory(backup);
                var prepared = J.Obj("previous", previous, "candidate", candidate, "backup", backup, "hadConfig", Directory.Exists(cfg));
                if (Directory.Exists(cfg)) CopyTree(cfg, Path.Combine(backup, "desktop-pet"));
                J.Save(Path.Combine(PetUpdateRoot, "transaction.json"), prepared); transaction = prepared; pet.SetDirectory(candidate);
                if (running) { var live = await pet.Start(); if (!J.Bool(live, "ready")) throw new Exception("新版桌宠未就绪。"); await pet.Run("visible", visible); }
                J.Save(Path.Combine(PetUpdateRoot, "active.json"), J.Obj("directory", candidate)); File.Delete(Path.Combine(PetUpdateRoot, "transaction.json")); transaction = null;
                PetUpdateState("status", "up-to-date", "currentVersion", version, "hasUpdate", false, "progress", 100);
            } catch (Exception error) { failure = error; }
            if (failure != null) {
                string message = failure.Message;
                try {
                    if (probe != null) await probe.Stop();
                    if (transaction != null) { await pet.Stop(); RestorePetConfig(transaction); pet.SetDirectory(previous); File.Delete(Path.Combine(PetUpdateRoot, "transaction.json")); }
                    if (running && !pet.Running && !Exiting) { await pet.Start(); await pet.Run("visible", visible); }
                } catch (Exception recovery) { message += " 恢复未完成，备份已保留：" + recovery.Message; }
                PetUpdateState("status", "error", "error", message);
            }
        }
    }
}
