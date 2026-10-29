using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Drawing;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Net.Http;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace XM.Native {
    internal sealed class PetRuntime {
        public string DirectoryPath { get; private set; }
        public readonly string DataPath;
        private Process child;
        private Task<object> starting;
        private string token;
        private int port;
        private TcpListener events;
        private Task eventLoop;
        public Action<string> Verify;
        private readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        public Action OpenPanel;
        public Action<string[]> DropPaths;
        public object State = J.Obj("ready", false, "visible", false, "settings", J.Obj(), "version", "4.3.4", "animationCount", 106);
        public bool Running { get { return child != null && !child.HasExited; } }
        public bool Visible { get { return Running && J.Bool(State, "visible"); } }
        public PetRuntime(string directory, string data) { DirectoryPath = directory; DataPath = data; }
        public object Manifest() { return J.Read(Path.Combine(DirectoryPath, "xm-manifest.json"), J.Obj()); }
        public void SetDirectory(string directory) { if (Running) throw new Exception("桌宠尚未退出。"); DirectoryPath = directory; port = 0; }
        public async Task<object> Status() {
            if (Running && port != 0) { try { return await Command("status", null); } catch (Exception error) { J.Map(State)["error"] = error.Message; } }
            else { var manifest = Manifest(); State = J.Obj("ready", false, "visible", false, "settings", J.Obj(), "version", J.Str(manifest, "version"), "animationCount", J.Arr(J.Get(manifest, "animations")).Length); }
            return State;
        }
        public async Task<object> Run(string action, object value = null) { await Start(); return await Command(action, value); }
        public async Task<object> Start() {
            if (Running && port != 0) return await Command("status", null);
            if (starting != null) return await starting;
            starting = StartCore(); try { return await starting; } finally { starting = null; }
        }
        private async Task<object> StartCore() {
            if (Verify != null) await Task.Run(() => Verify(DirectoryPath));
            Directory.CreateDirectory(DataPath); string session = Guid.NewGuid().ToString("N");
            var random = new byte[32]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(random); token = BitConverter.ToString(random).Replace("-", "").ToLowerInvariant();
            events = new TcpListener(IPAddress.Loopback, 0); events.Start();
            var listener = events;
            eventLoop = Task.Run(async () => {
                while (events == listener) {
                    TcpClient client;
                    try { client = await listener.AcceptTcpClientAsync(); }
                    catch (ObjectDisposedException) { break; } catch (SocketException) { break; }
                    // A slow or malformed event is isolated to its connection. The next
                    // double-click must still be able to open the companion card.
                    using (client) try {
                        var handling = ReceiveEvent(client);
                        if (await Task.WhenAny(handling, Task.Delay(3000)) != handling) client.Close();
                        await handling;
                    } catch (Exception) { }
                }
            });
            var info = new ProcessStartInfo(Path.Combine(DirectoryPath, "dsh-pet-standalone-webm-chat.exe")) { WorkingDirectory = DirectoryPath, UseShellExecute = false, CreateNoWindow = true };
            info.EnvironmentVariables["XM_COMPANION_DATA"] = DataPath; info.EnvironmentVariables["XM_COMPANION_TOKEN"] = token; info.EnvironmentVariables["XM_COMPANION_SESSION"] = session;
            info.EnvironmentVariables["XM_COMPANION_EVENT_PORT"] = ((IPEndPoint)events.LocalEndpoint).Port.ToString(); info.EnvironmentVariables["XM_COMPANION_PARENT_PID"] = Process.GetCurrentProcess().Id.ToString();
            info.EnvironmentVariables["XM_COMPANION_HOST"] = Application.ExecutablePath; info.EnvironmentVariables["XM_COMPANION_HOST_ARGS"] = "[]";
            foreach (string key in new[] { "XM_COMPANION_OWNER_PID", "QT_PLUGIN_PATH", "QT_QPA_PLATFORM_PLUGIN_PATH" }) info.EnvironmentVariables.Remove(key);
            child = Process.Start(info);
            for (int n = 0; n < 200 && !child.HasExited; n++) {
                object bridge = null; try { bridge = J.Read(Path.Combine(DataPath, "companion-bridge.json"), null); } catch {}
                if (J.Str(bridge, "session") == session && J.Num(bridge, "pid") == child.Id && J.Num(bridge, "port") > 0) { port = (int)J.Num(bridge, "port"); return await Command("status", null); }
                await Task.Delay(150);
            }
            await Stop(); throw new Exception("桌宠启动失败，请查看桌宠日志。");
        }
        private async Task ReceiveEvent(TcpClient client) {
            using (var stream = client.GetStream()) {
                var header = new MemoryStream(); var one = new byte[1];
                while (header.Length < 8192) {
                    if (await stream.ReadAsync(one, 0, 1) == 0) return;
                    header.WriteByte(one[0]); var bytes = header.GetBuffer(); int n = (int)header.Length;
                    if (n >= 4 && bytes[n-4] == 13 && bytes[n-3] == 10 && bytes[n-2] == 13 && bytes[n-1] == 10) break;
                }
                var lines = Encoding.ASCII.GetString(header.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
                string auth = ""; int length = 0; bool origin = false;
                foreach (string line in lines.Skip(1)) {
                    if (line.StartsWith("Authorization:", StringComparison.OrdinalIgnoreCase)) auth = line.Substring(14).Trim();
                    if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) int.TryParse(line.Substring(15), out length);
                    if (line.StartsWith("Origin:", StringComparison.OrdinalIgnoreCase)) origin = true;
                }
                bool accepted = lines[0] == "POST /event HTTP/1.1" && auth == "Bearer " + token && !origin && length > 0 && length <= 262144;
                string action = ""; string[] paths = new string[0];
                if (accepted) {
                    byte[] body = new byte[length]; int read = 0, n;
                    while (read < length && (n = await stream.ReadAsync(body, read, length - read)) > 0) read += n;
                    if (read != length) return;
                    var request = J.Decode(Encoding.UTF8.GetString(body)); action = J.Str(request, "action");
                    paths = J.Arr(J.Get(request, "paths")).OfType<string>().ToArray();
                    accepted = action == "open-panel" || action == "drop-paths" && paths.Length > 0 && paths.Length <= 2000;
                }
                byte[] reply = Encoding.ASCII.GetBytes("HTTP/1.1 " + (accepted ? "204 No Content" : "403 Forbidden") + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); await stream.WriteAsync(reply, 0, reply.Length);
                if (accepted && action == "open-panel" && OpenPanel != null) OpenPanel();
                if (accepted && action == "drop-paths" && DropPaths != null) DropPaths(paths);
            }
        }
        private async Task<object> Command(string action, object value) {
            using (var req = new HttpRequestMessage(HttpMethod.Post, "http://127.0.0.1:" + port + "/command")) {
                req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token); req.Content = new StringContent(J.Encode(J.Obj("action", action, "value", value)), Encoding.UTF8, "application/json");
                using (var response = await http.SendAsync(req)) { var result = J.Decode(await response.Content.ReadAsStringAsync()); if (!response.IsSuccessStatusCode || J.Str(result, "error").Length > 0) throw new Exception(J.Str(result, "error", "桌宠连接失败。")); return State = result; }
            }
        }
        public async Task Stop() {
            var own = child; if (own != null && !own.HasExited) {
                try { if (port > 0) await Command("quit", null); } catch {}
                for (int n = 0; n < 40 && !own.HasExited; n++) await Task.Delay(200);
                if (!own.HasExited) { own.Kill(); await Task.Run(() => own.WaitForExit(3000)); }
            }
            child = null; port = 0; var listener = events; events = null; if (listener != null) listener.Stop();
            if (eventLoop != null) await eventLoop;
        }
    }
    internal sealed partial class StudioHost {
        private PetRuntime pet;
        private Dictionary<string, object> petSettings;
        private readonly System.Windows.Forms.Timer petTimer = new System.Windows.Forms.Timer { Interval = 2000 };
        private bool petPolling, lastPetTaskBusy;
        private string PetDirectory { get { return pet.DirectoryPath; } }
        private bool PetVisible { get { return pet != null && pet.Visible; } }
        private string PetName { get { return J.Str(petSettings, "name", "大肥鱼"); } }
        private void InitCompanion() {
            petSettings = J.Obj("name", "大肥鱼", "showName", true, "palette", "original", "size", "normal", "motion", true, "roam", false, "sound", false, "volume", 40, "idleInterval", 30);
            try { foreach (var pair in J.Map(J.Read(Path.Combine(DataDir, "companion-settings.json"), null))) if (petSettings.ContainsKey(pair.Key)) petSettings[pair.Key] = pair.Value; } catch (Exception error) { Log(error.Message); }
            pet = new PetRuntime(Path.Combine(BaseDir, "resources", "companion"), DataDir); pet.OpenPanel = () => Ui(async () => { try { await OpenPetPanel(); } catch (Exception error) { Notify(error.Message); } });
            pet.DropPaths = paths => Ui(async () => await ReceivePetDrop(paths));
            pet.Verify = directory => VerifyPet(directory);
            InitPetUpdate();
            petTimer.Tick += async (s, e) => { if (petPolling || Exiting) return; petPolling = true; try { await BroadcastPet(); } catch (Exception error) { Log(error.Message); } finally { petPolling = false; } }; petTimer.Start();
        }
        private async Task<object> BroadcastPet() {
            bool taskBusy = J.Bool(jyState, "busy") || J.Bool(jyState, "recording") || J.Bool(jyState, "exporting") || wmRunning;
            if (pet.Running && taskBusy != lastPetTaskBusy && petUpdateTask == null) { await pet.Run("task-state", taskBusy); lastPetTaskBusy = taskBusy; }
            object state = J.Obj("visible", PetVisible, "panelOpen", PanelWindow != null && PanelWindow.Visible, "theme", theme, "settings", petSettings, "native", await pet.Status(), "update", petUpdate,
                "pendingDropCount", pendingDrop.Length, "dropNotice", dropNotice, "renameOpen", petRename, "renamePlan", J.Get(jyState, "plan", new object[0]), "renameFileCount", J.Get(jyState, "fileCount", 0),
                "jianying", J.Obj("ready", J.Bool(jyState, "ready"), "busy", J.Bool(jyState, "busy") || J.Bool(jyState, "recording"), "status", J.Str(jyState, "status", "引擎准备中"), "queueCount", J.Arr(J.Get(jyState, "queue")).Length, "modal", J.Get(jyState, "modal"), "lastLog", J.Arr(J.Get(jyState, "logs")).LastOrDefault()),
                "watermark", J.Obj("running", wmRunning, "progress", J.Get(WatermarkState(), "overallProgress"), "jobs", wmJobs), "periodEnabled", workspacePeriod);
            Emit("bos:companion-state", state); if (PanelView != null) Emit("bos:companion-state", state, PanelView); return state;
        }
        private async Task OpenPetPanel() { if (panelOpening != null) { await panelOpening; return; } panelOpening = OpenPetPanelCore(); try { await panelOpening; } finally { panelOpening = null; } }
        private async Task OpenPetPanelCore() {
            try { jyState = await jyEngine.Call("status"); } catch (Exception error) { Log("panel-engine " + error.Message); }
            if (PanelWindow == null || PanelWindow.IsDisposed) {
                PanelWindow = new StudioWindow(true) { Opacity = .95 }; PanelView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent }; PanelWindow.Controls.Add(PanelView);
                var position = J.Read(Path.Combine(DataDir, "companion-panel-position.json"), null); var point = new Point((int)J.Num(position, "x", Cursor.Position.X), (int)J.Num(position, "y", Cursor.Position.Y)); var area = Screen.FromPoint(point).WorkingArea;
                PanelWindow.Location = new Point(Math.Max(area.Left, Math.Min(area.Right - PanelWindow.Width, (int)J.Num(position, "x", area.Right - 370))), Math.Max(area.Top, Math.Min(area.Bottom - PanelWindow.Height, (int)J.Num(position, "y", area.Bottom - 520))));
                PanelWindow.Move += (s, e) => J.Save(Path.Combine(DataDir, "companion-panel-position.json"), J.Obj("x", PanelWindow.Left, "y", PanelWindow.Top));
                PanelWindow.FormClosing += (s, e) => { if (!Exiting) { e.Cancel = true; PanelWindow.Hide(); } };
                var handle = PanelWindow.Handle; PanelView.CreateControl();
                await InitializeView(PanelView, "main", Origin + "/companion-panel.html", true);
            } else PanelWindow.Show();
            await BroadcastPet();
        }
        private async Task<object> CompanionAction(string action, object value) {
            if (action == "drop-choice") { await ChoosePetDrop(Convert.ToString(value)); return await BroadcastPet(); }
            if (action == "rename-preview" || action == "rename-run") {
                jyState = await jyEngine.Call(action == "rename-preview" ? "preview" : "rename", action == "rename-preview" ? J.Obj("folder", "", "template", Convert.ToString(value), "ai", false) : J.Obj());
                return await BroadcastPet();
            }
            if (action == "rename-close") { petRename = false; return await BroadcastPet(); }
            if (action == "animations") return J.Get(pet.Manifest(), "animations", new object[0]);
            if (action == "check-update") { await CheckPetUpdate(); return await BroadcastPet(); }
            if (action == "install-update") { await InstallPetUpdate(); return await BroadcastPet(); }
            if (action == "sync") return await BroadcastPet();
            if (petUpdateTask != null) throw new Exception("桌宠正在更新，请稍后操作。");
            if (action == "show" || action == "hide" || action == "toggle") {
                bool show = action == "show" || action == "toggle" && !PetVisible;
                if (show || pet.Running) await pet.Run("visible", show);
                if (!show && PanelWindow != null) PanelWindow.Hide();
            } else if (action == "panel") { if (Equals(value, true) || Equals(value, "toggle") && (PanelWindow == null || !PanelWindow.Visible)) await OpenPetPanel(); else if (PanelWindow != null) PanelWindow.Hide(); }
            else if (action == "update-settings") { foreach (var pair in J.Map(value)) if (petSettings.ContainsKey(pair.Key)) petSettings[pair.Key] = pair.Value; petSettings["palette"] = "original"; string name = J.Str(petSettings, "name").Trim(); petSettings["name"] = name.Length == 0 ? "大肥鱼" : name.Substring(0, Math.Min(20, name.Length)); J.Save(Path.Combine(DataDir, "companion-settings.json"), petSettings);
                var patch = J.Obj(); if (J.Map(value).ContainsKey("size")) patch["scale"] = J.Str(value, "size") == "small" ? .5 : J.Str(value, "size") == "large" ? 1 : .72;
                if (J.Map(value).ContainsKey("roam")) patch["no_move"] = !J.Bool(value, "roam"); if (J.Map(value).ContainsKey("sound")) patch["click_sound_enabled"] = J.Bool(value, "sound"); if (J.Map(value).ContainsKey("volume")) patch["click_sound_volume"] = Math.Max(0, Math.Min(1, J.Num(value, "volume") / 100)); if (J.Map(value).ContainsKey("idleInterval")) patch["animation_gap_seconds"] = J.Num(value, "idleInterval"); if (patch.Count > 0) await pet.Run("update", patch);
            } else if (new[] { "native-settings", "native-update", "native-play", "reset-position", "spawn", "chat", "todo" }.Contains(action)) await pet.Run(action == "native-settings" ? "settings" : action == "native-update" ? "update" : action == "native-play" ? "play" : action, value);
            else if (action == "react") { var clips = J.Arr(J.Get(pet.Manifest(), "animations")).Where(x => J.Str(x, "category") == "click").ToArray(); if (clips.Length > 0) await pet.Run("play", J.Str(clips[new Random().Next(clips.Length)], "id")); }
            else if (action == "launch-jianying" || action == "launch-jy") await QuickLaunch("launch", null);
            else if (action == "navigate") { OpenMain(); Emit("bos:tray-navigate", Convert.ToString(value)); }
            else if (action == "workspace") { OpenMain(); Emit("bos:tray-navigate", "workspace"); }
            else if (action == "period" || action == "toggle-period") await ConfigurePeriod(!workspacePeriod, "compatible", false);
            else if (action == "jy-stop") await ProgressAction("stop");
            else if (action.StartsWith("jy-")) { OpenMain(); Emit("bos:companion-request", J.Obj("action", action, "value", value)); }
            else if (action == "wm-add") await WatermarkAction("choose-videos", null);
            else if (action == "wm-run") await WatermarkAction(wmRunning ? "cancel" : "start", null);
            else if (action == "wm-start") await WatermarkAction("start", null);
            else if (action == "wm-cancel") await WatermarkAction("cancel", null);
            else if (action == "wm-open") { var job = wmJobs.Find(x => J.Str(x, "status") == "done" && J.Str(x, "outputPath") == Convert.ToString(value)); if (job == null) throw new Exception("找不到已完成的水印视频。"); await WatermarkAction("open-job", J.Str(job, "id")); }
            else throw new Exception("未知桌宠操作：" + action);
            return await BroadcastPet();
        }
        private async Task StopCompanion() { petTimer.Stop(); await pet.Stop(); }
    }
}
