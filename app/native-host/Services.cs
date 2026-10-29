using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Drawing;
using System.Diagnostics;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private Engine jyEngine, watermarkEngine, periodEngine;
        private object jyState = J.Obj("ready", false, "status", "引擎准备中", "queue", new object[0]);
        private readonly HttpClient http = new HttpClient(new HttpClientHandler { AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate }) { Timeout = Timeout.InfiniteTimeSpan };
        private readonly ConcurrentDictionary<string, CancellationTokenSource> requests = new ConcurrentDictionary<string, CancellationTokenSource>();
        private readonly Dictionary<string, Task> aiReady = new Dictionary<string, Task>();
        private readonly Dictionary<string, string> aiErrors = new Dictionary<string, string>();
        private readonly HashSet<string> aiLoading = new HashSet<string>();
        private int aiLayoutGeneration;
        private void InitServices() {
            http.DefaultRequestHeaders.UserAgent.ParseAdd("XM-Editing-Studio/" + Version);
            string jy = Path.Combine(BaseDir, "resources", "jianying");
            jyEngine = new Engine(Path.Combine(jy, "JianYingEngine.exe"), "--data-dir " + J.Quote(Path.Combine(DataDir, "jianying-ai", "settings")), J.Str(J.Read(Path.Combine(jy, "engine.json"), null), "sha256"));
            jyEngine.Event = message => Ui(() => HandleEngineEvent(message));
            string wm = Path.Combine(BaseDir, "resources", "watermark");
            watermarkEngine = new Engine(Path.Combine(wm, "WatermarkEngine.exe"), "", J.Str(J.Read(Path.Combine(wm, "engine.json"), null), "sha256"));
            watermarkEngine.Event = message => Ui(() => WatermarkProgress(message));
            string period = Path.Combine(BaseDir, "resources", "helpers", "PeriodKeeper.exe");
            periodEngine = new Engine(period, "--parent-pid " + Process.GetCurrentProcess().Id, J.Str(J.Read(Path.Combine(BaseDir, "resources", "native-manifest.json"), null), "periodSha256"));
            InitClipboard(); InitLibrary(); InitCompanion(); InitWatermark();
            browserWatermark = new BrowserWatermark(ClientDir, DataDir);
        }
        private async Task StopServices() {
            foreach (var item in requests) item.Value.Cancel();
            browserWatermark.Dispose();
            updateClosing.Cancel();
            if (petUpdateTask != null) await petUpdateTask;
            if (wmRunning) { wmCancelled = true; try { await watermarkEngine.Call("cancel", null, false, 5000, true); } catch {} }
            if (wmTask != null) await wmTask;
            await StopCompanion(); StopClipboard();
            if (progressWindow != null) progressWindow.Dispose();
            jyEngine.Dispose(); watermarkEngine.Dispose(); periodEngine.Dispose(); http.Dispose();
        }
        private async Task<object> Dispatch(WebView2 sender, string command, Dictionary<string, object> p) {
            switch (command) {
                case "window-control": return WindowControl(sender, J.Str(p, "action"));
                case "notify": Notify(J.Str(p, "message")); return true;
                case "progress-message": if (currentProgress != null) { J.Map(currentProgress)["message"] = J.Str(p, "message"); ShowProgress(currentProgress); } return true;
                case "titlebar-theme": {
                    var value = J.Str(p, "theme");
                    if (!new[] { "obsidian", "ios", "aurora", "graphite", "ocean", "burgundy", "midnight", "plum", "pine", "matcha", "sunset" }.Contains(value)) throw new Exception("无效的主题。");
                    theme = value; MainWindow.Palette(!new[] { "ios", "matcha", "sunset" }.Contains(theme)); Emit("bos:companion-theme", theme, PanelView); await UpdateMainPalette(); await UpdatePanelPalette(); return true;
                }
                case "http-fetch": return await Fetch(p);
                case "http-cancel": { CancellationTokenSource token; if (requests.TryGetValue(J.Str(p, "requestId"), out token)) token.Cancel(); return null; }
                case "choose-directory": return ChooseFolder();
                case "read-cache": return J.Obj("ok", true, "data", J.Read(CachePath(p), null));
                case "write-cache": { string path = CachePath(p); J.Save(path, J.Get(p, "data")); return J.Obj("ok", true, "path", path); }
                case "download-audio": return await DownloadAudio(p);
                case "export-script-materials": return await ExportMaterials(p);
                case "music-library-list": return libraryCatalog;
                case "music-library-refresh": return await ScanLibrary();
                case "music-library-connect": { string folder = ChooseFolder(); if (folder.Length > 0) { if (musicRoots.Count >= 20 && !musicRoots.Contains(folder)) throw new Exception("最多连接20个音乐文件夹。"); if (!musicRoots.Contains(folder)) musicRoots.Add(folder); SaveLibrary(); } return await ScanLibrary(); }
                case "music-library-disconnect": { musicRoots.RemoveAll(root => J.Hash(root.ToLowerInvariant()) == J.Str(p, "id")); SaveLibrary(); return await ScanLibrary(); }
                case "prepare-music-drag": return PrepareDrag(p);
                case "start-music-drag": { string path = ResolveDrag(J.Str(p, "token")); sender.DoDragDrop(new DataObject(DataFormats.FileDrop, new[] { path }), DragDropEffects.Copy); return null; }
                case "period-status": return await PeriodStatus("status");
                case "period-probe": return await PeriodStatus("probe");
                case "period-enabled": return await ConfigurePeriod(J.Bool(p, "enabled"), J.Str(p, "mode", "compatible"), false);
                case "period-batch-enabled": return await ConfigurePeriod(J.Bool(p, "enabled"), "compatible", true);
                case "period-copy": return await CopySubtitle(J.Str(p, "text"), J.Map(J.Get(p, "options")));
                case "clipboard-text": await WriteClipboard(J.Str(p, "text"), J.Str(p, "text")); return true;
                case "jianying-action": {
                    string action = J.Str(p, "action");
                    if (!new[] { "status", "stop", "modal", "scan", "wizard", "export", "extract", "fonts", "unhide", "paths", "files", "preview", "rename", "settings", "select_template", "rename_template", "delete_template", "ai_result", "recording_capture_ready", "scan_capture_ready" }.Contains(action)) throw new Exception("无效的剪映操作。");
                    jyState = await jyEngine.Call(action, J.Get(p, "args")); return jyState;
                }
                case "jianying-files": return ChooseFiles("视频、音频和字幕|*.mp4;*.mov;*.avi;*.mkv;*.mp3;*.wav;*.srt;*.ass|所有文件|*.*");
                case "progress-action": return await ProgressAction(J.Str(p, "action"));
                case "web-ai-layout": return await LayoutAI(p);
                case "web-ai-action": return await AIAction(p);
                case "web-ai-run": return await RunAI(p);
                case "quick-launch": return await QuickLaunch(J.Str(p, "action"), J.Get(p, "value"));
                case "watermark-action": return await WatermarkAction(J.Str(p, "action"), J.Get(p, "value"));
                case "watermark-browsers": return BrowserWatermark.Discover().Select(x => J.Obj("id", J.Str(x, "id"), "name", J.Str(x, "name"), "available", J.Bool(x, "available"))).ToArray();
                case "companion-action": return await CompanionAction(J.Str(p, "action"), J.Get(p, "value"));
                case "updater-status": return updater;
                case "updater-action": return await UpdateAction(J.Str(p, "action"));
                default: throw new Exception("未知本机操作：" + command);
            }
        }
        private string ChooseFolder() { using (var dialog = new FolderBrowserDialog { Description = "选择文件夹", ShowNewFolderButton = true }) return dialog.ShowDialog(MainWindow) == DialogResult.OK ? dialog.SelectedPath : ""; }
        private string[] ChooseFiles(string filter) { using (var dialog = new OpenFileDialog { Multiselect = true, Filter = filter }) return dialog.ShowDialog(MainWindow) == DialogResult.OK ? dialog.FileNames : new string[0]; }
        private static string CachePath(object p) { string directory = J.Str(p, "directory"), name = J.Str(p, "fileName", "music-cache.json"); if (!Path.IsPathRooted(directory) || name.Length == 0 || Path.GetFileName(name) != name) throw new Exception("无效的保存路径。"); return J.Under(directory, name); }
        private async Task<object> Fetch(Dictionary<string, object> p) {
            string url = J.Str(p, "url"), id = J.Str(p, "requestId", Guid.NewGuid().ToString("N"));
            if (!Http(url)) throw new Exception("只支持 HTTP 或 HTTPS 请求。");
            using (var cts = new CancellationTokenSource(Math.Min(600000, Math.Max(1000, (int)J.Num(p, "timeout", 240000))))) {
                if (!requests.TryAdd(id, cts)) throw new Exception("重复的请求编号。");
                try {
                    using (var req = new HttpRequestMessage(new HttpMethod(J.Str(p, "method", "GET")), url)) {
                        string body = J.Str(p, "body"); if (body.Length > 12 * 1024 * 1024) throw new Exception("请求过大。");
                        if (req.Method != HttpMethod.Get && req.Method != HttpMethod.Head) req.Content = new StringContent(body, Encoding.UTF8, "application/json");
                        foreach (var header in J.Map(J.Get(p, "headers"))) {
                            if (new[] { "host", "content-length", "connection", "transfer-encoding" }.Contains(header.Key.ToLowerInvariant())) continue;
                            if (!req.Headers.TryAddWithoutValidation(header.Key, Convert.ToString(header.Value)) && req.Content != null) { req.Content.Headers.Remove(header.Key); req.Content.Headers.TryAddWithoutValidation(header.Key, Convert.ToString(header.Value)); }
                        }
                        using (var response = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token)) {
                            using (var stream = await response.Content.ReadAsStreamAsync()) using (var memory = new MemoryStream()) {
                                var buffer = new byte[32768]; int count;
                                while ((count = await stream.ReadAsync(buffer, 0, buffer.Length, cts.Token)) > 0) { if (memory.Length + count > 24 * 1024 * 1024) throw new Exception("接口返回内容过大。"); memory.Write(buffer, 0, count); }
                                var headers = response.Headers.Concat(response.Content.Headers).ToDictionary(x => x.Key.ToLowerInvariant(), x => (object)string.Join(", ", x.Value));
                                return J.Obj("ok", response.IsSuccessStatusCode, "status", (int)response.StatusCode, "body", Encoding.UTF8.GetString(memory.ToArray()), "headers", headers);
                            }
                        }
                    }
                } catch (OperationCanceledException) { throw new Exception("请求已取消或超时。"); }
                finally { CancellationTokenSource removed; requests.TryRemove(id, out removed); }
            }
        }
        private async Task<object> LayoutAI(object p) {
            int generation = ++aiLayoutGeneration;
            if (!J.Bool(p, "visible")) { foreach (var value in aiViews.Values) value.Hide(); activeAi = ""; return null; }
            string provider = J.Str(p, "provider"); if (provider != "deepseek" && provider != "doubao") throw new Exception("无效的网页模型。");
            WebView2 view;
            if (!aiViews.TryGetValue(provider, out view)) {
                view = new WebView2 { Visible = false, DefaultBackgroundColor = Color.White }; aiViews[provider] = view; MainWindow.Controls.Add(view);
                aiReady[provider] = InitializeAI(view, provider);
            }
            await aiReady[provider];
            if (generation != aiLayoutGeneration) return AIState(provider);
            foreach (var item in aiViews.Values) if (item != view) item.Hide();
            object bounds = J.Get(p, "bounds"); double zoom = MainView.ZoomFactor;
            using (var graphics = MainWindow.CreateGraphics()) zoom *= graphics.DpiX / 96.0;
            int x = MainView.Left + Math.Max(0, (int)Math.Round(J.Num(bounds, "x") * zoom));
            int y = MainView.Top + Math.Max((int)Math.Round(36 * zoom), (int)Math.Round(J.Num(bounds, "y") * zoom));
            int width = Math.Max(0, Math.Min(MainView.Right - x, (int)Math.Round(J.Num(bounds, "width") * zoom)));
            int height = Math.Max(0, Math.Min(MainView.Bottom - y, (int)Math.Round(J.Num(bounds, "height") * zoom)));
            var rectangle = new Rectangle(x, y, width, height);
            if (view.Bounds != rectangle) view.Bounds = rectangle;
            bool visible = width > 100 && height > 80, changed = view.Visible != visible || activeAi != provider;
            if (view.Visible != visible) view.Visible = visible;
            if (visible && changed) view.BringToFront(); activeAi = provider;
            return AIState(provider);
        }
        private async Task InitializeAI(WebView2 view, string provider) {
            aiLoading.Add(provider);
            await InitializeView(view, "official-" + provider, provider == "deepseek" ? "https://chat.deepseek.com/" : "https://www.doubao.com/chat/", false);
            view.CoreWebView2.NavigationStarting += (s, e) => { aiLoading.Add(provider); aiErrors[provider] = ""; };
            view.CoreWebView2.NavigationCompleted += (s, e) => { aiLoading.Remove(provider); aiErrors[provider] = e.IsSuccess ? "" : "网页加载失败：" + e.WebErrorStatus + "，可刷新重试。"; };
        }
        private object AIState(string provider) { WebView2 view; string error; aiErrors.TryGetValue(provider, out error); return J.Obj("provider", provider, "loading", aiLoading.Contains(provider), "url", aiViews.TryGetValue(provider, out view) && view.CoreWebView2 != null ? view.CoreWebView2.Source : "", "error", error ?? ""); }
        private async Task<object> AIAction(object p) {
            string provider = J.Str(p, "provider"), action = J.Str(p, "action"); WebView2 view;
            if (action == "external") { OpenPath(provider == "deepseek" ? "https://chat.deepseek.com/" : "https://www.doubao.com/chat/"); return J.Obj("external", true); }
            if (!aiViews.TryGetValue(provider, out view) || view.CoreWebView2 == null) throw new Exception("请先打开官方 AI 页面。");
            if (action == "reload") view.CoreWebView2.Reload();
            if (action == "home") view.CoreWebView2.Navigate(provider == "deepseek" ? "https://chat.deepseek.com/" : "https://www.doubao.com/chat/");
            await Task.Yield(); return AIState(provider);
        }
        private async Task<object> RunAI(object p) {
            string provider = J.Str(p, "provider"); WebView2 view;
            if (activeAi != provider || !aiViews.TryGetValue(provider, out view) || !view.Visible || view.CoreWebView2 == null) throw new Exception("请在内嵌官方页面完成登录。");
            Uri uri; if (!Uri.TryCreate(view.CoreWebView2.Source, UriKind.Absolute, out uri) || uri.Scheme != "https" || !(provider == "deepseek" ? uri.Host == "chat.deepseek.com" : uri.Host == "www.doubao.com" || uri.Host == "doubao.com")) return J.Obj("state", "login", "message", "请在官网完成登录。");
            string script = J.Str(p, "script"); if (script.Length > 16 * 1024 * 1024) throw new Exception("截图内容过大。");
            var result = J.Decode(await view.CoreWebView2.ExecuteScriptAsync(script));
            if (J.Str(result, "state") == "enter") { OpenMain(); view.Focus(); SendKeys.SendWait("{ENTER}"); return J.Obj("state", "sent"); }
            return result;
        }
    }
}
