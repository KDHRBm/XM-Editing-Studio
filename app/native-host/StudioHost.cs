using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Drawing;
using System.Diagnostics;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace XM.Native {
    internal sealed partial class StudioHost : ApplicationContext {
        internal const string Origin = "https://xm.local", Version = "1.4.3";
        internal readonly string BaseDir, DataDir, ClientDir;
        internal StudioWindow MainWindow, PanelWindow;
        internal WebView2 MainView, PanelView;
        internal bool Exiting;
        private string theme = "graphite";
        private NotifyIcon tray;
        private readonly System.Windows.Forms.Timer wakeTimer = new System.Windows.Forms.Timer { Interval = 300 };
        private readonly EventWaitHandle wake;
        private readonly Dictionary<string, WebView2> aiViews = new Dictionary<string, WebView2>();
        private readonly HashSet<Form> popups = new HashSet<Form>();
        private string activeAi = "";
        private Task panelOpening;
        private Task mainOpening;
        private readonly string bridge;
        private readonly Dictionary<string, Task<CoreWebView2Environment>> environments = new Dictionary<string, Task<CoreWebView2Environment>>();
        internal StudioHost(string profile, EventWaitHandle wakeEvent) {
            BaseDir = AppDomain.CurrentDomain.BaseDirectory; DataDir = profile; wake = wakeEvent;
            ClientDir = Path.Combine(BaseDir, "resources", "client"); Directory.CreateDirectory(DataDir);
            bridge = File.ReadAllText(Path.Combine(ClientDir, "assets", "native-bridge.js"), Encoding.UTF8);
            MainWindow = new StudioWindow(); MainView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = MainWindow.BackColor };
            MainWindow.Controls.Add(MainView);
            var icon = Path.Combine(BaseDir, "app-icon.ico"); if (File.Exists(icon)) MainWindow.Icon = new Icon(icon);
            MainWindow.FormClosing += (s, e) => { if (!Exiting && PetVisible) { e.Cancel = true; MainWindow.Hide(); } else if (!Exiting) { e.Cancel = true; Quit(); } };
            MainWindow.Shown += async (s, e) => { if (mainOpening != null) return; try { mainOpening = InitializeView(MainView, "main", Origin + "/index.html", true); await mainOpening; Log("main-ready"); } catch (Exception error) { Log(error.ToString()); MessageBox.Show(MainWindow, error.Message, "XM剪辑台启动失败"); Quit(); } };
            InitServices(); InitTray(); InitQA();
            wakeTimer.Tick += (s, e) => { if (wake.WaitOne(0)) OpenMain(); }; wakeTimer.Start();
            MainWindow.Show();
        }
        internal void Log(string message) { try { File.AppendAllText(Path.Combine(DataDir, "startup-native.log"), DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine); } catch {} }
        internal void Ui(Action action) { if (Exiting || MainWindow.IsDisposed) return; if (MainWindow.InvokeRequired) MainWindow.BeginInvoke(action); else action(); }
        internal void OpenMain() { Ui(() => { MainWindow.Show(); if (MainWindow.WindowState == FormWindowState.Minimized) MainWindow.WindowState = FormWindowState.Normal; MainWindow.Activate(); }); }
        internal void Emit(string name, object value, WebView2 target = null) {
            Ui(() => { var view = target ?? MainView; if (view != null && !view.IsDisposed && view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(J.Encode(J.Obj("event", name, "data", value))); });
        }
        private static bool Http(string value) { Uri uri; return Uri.TryCreate(value, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http") && uri.UserInfo.Length == 0; }
        internal static void OpenPath(string path) { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
        private async Task InitializeView(WebView2 view, string partition, string url, bool local) {
            Log("view-initialize " + partition);
            Task<CoreWebView2Environment> environment;
            if (!environments.TryGetValue(partition, out environment)) environments[partition] = environment = CoreWebView2Environment.CreateAsync(null, Path.Combine(DataDir, "native-webview", partition));
            var env = await environment;
            await view.EnsureCoreWebView2Async(env);
            Log("view-ready " + partition);
            var core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("XM_NATIVE_QA") == "1";
            core.Settings.IsStatusBarEnabled = false; core.Settings.AreHostObjectsAllowed = false;
            if (local) {
                // C# resolves the private origin, including media ranges; no HTTP page server.
                await core.AddScriptToExecuteOnDocumentCreatedAsync("if(location.origin==='" + Origin + "'&&window.top===window){" + bridge + "}");
                core.WebMessageReceived += (s, e) => {
                    // Remote web contents and child frames never receive local APIs.
                    if (e.Source != Origin + "/index.html" && e.Source.Split('?')[0] != Origin + "/companion-panel.html" && e.Source != Origin + "/jianying-scan/index.html") return;
                    Dictionary<string, object> request; try { request = J.Map(J.Decode(e.TryGetWebMessageAsString())); } catch { return; }
                    object id = J.Get(request, "id"); var command = J.Str(request, "cmd");
                    if (Environment.GetEnvironmentVariable("XM_NATIVE_QA") == "1") Log("request " + command);
                    var attachedFiles = command == "watermark-drop" || command == "watermark-browser-open" || command == "music-library-drop" || command == "quick-folders-drop" ? e.AdditionalObjects.OfType<CoreWebView2File>().Select(file => (object)file.Path).ToArray() : new object[0];
                    // WebView2 callbacks must return before opening dialogs or another browser.
                    MainWindow.BeginInvoke(new Action(async () => {
                    try {
                        if (view != MainView && command != "companion-action" && command != "window-control" && command != "progress-action") throw new Exception("此操作仅允许在主工作台执行。");
                        object value;
                        if (command == "watermark-drop" && view == MainView) {
                            var files = attachedFiles;
                            if (files.Length == 0) throw new Exception("未取得视频路径，请使用选择视频按钮。");
                            value = await WatermarkAction("add-videos", files);
                        } else if (command == "music-library-drop" && view == MainView) value = await ConnectMusicFolders(attachedFiles.Select(Convert.ToString));
                        else if (command == "quick-folders-drop" && view == MainView) value = await AddQuickFolders(attachedFiles.Select(Convert.ToString));
                        else if (command == "watermark-browser-open" && view == MainView) value = browserWatermark.Open(J.Get(request, "payload"), attachedFiles.Select(Convert.ToString).ToArray());
                        else value = await Dispatch(view, command, J.Map(J.Get(request, "payload")));
                        if (!view.IsDisposed) core.PostWebMessageAsJson(J.Encode(J.Obj("id", id, "result", value)));
                    } catch (Exception error) { Log("request-error " + command + " " + error.GetType().Name); if (!view.IsDisposed) core.PostWebMessageAsJson(J.Encode(J.Obj("id", id, "error", error.Message))); }
                    }));
                };
                core.NavigationStarting += (s, e) => { if (!e.Uri.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase)) { e.Cancel = true; if (Http(e.Uri)) OpenPath(e.Uri); } };
                core.NewWindowRequested += (s, e) => { e.Handled = true; if (Http(e.Uri)) OpenPath(e.Uri); };
                ConfigureResources(core);
                core.NavigationCompleted += async (s, e) => {
                    if (!e.IsSuccess) { Log("navigation-error " + e.WebErrorStatus); return; }
                    if (view == MainView && core.Source == Origin + "/native-migrate.html") { try { await ImportLegacyStorage(core); core.Navigate(Origin + "/index.html"); } catch (Exception error) { Log("migration " + error); MessageBox.Show(MainWindow, "数据迁移未完成，旧数据仍保留。\n" + error.Message, "XM剪辑台"); } }
                    else if (view == progressView) { progressReady = true; if (currentProgress != null) ShowProgress(currentProgress); }
                    else {
                        Emit("bos:companion-theme", theme, view);
                        if (view == MainView) await UpdateMainPalette();
                        if (view == PanelView) {
                            await UpdatePanelPalette();
                            if (!Exiting) PanelWindow.Show();
                        }
                    }
                };
            } else {
                core.Settings.IsWebMessageEnabled = false;
                core.NavigationStarting += (s, e) => { if (!Http(e.Uri) && e.Uri != "about:blank") e.Cancel = true; };
                core.PermissionRequested += (s, e) => { e.State = e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead ? CoreWebView2PermissionState.Default : CoreWebView2PermissionState.Deny; };
                core.NewWindowRequested += async (s, e) => {
                    e.Handled = true; if (!Http(e.Uri)) return; var deferral = e.GetDeferral();
                    try {
                        var popup = new Form { Width = 960, Height = 740, Text = "官方账号登录" }; var web = new WebView2 { Dock = DockStyle.Fill };
                        popup.Controls.Add(web); popups.Add(popup); popup.FormClosed += (_s, _e) => popups.Remove(popup);
                        await web.EnsureCoreWebView2Async(env); web.CoreWebView2.Settings.AreHostObjectsAllowed = false; web.CoreWebView2.Settings.IsWebMessageEnabled = false;
                        web.CoreWebView2.NavigationStarting += (_s, nav) => { if (!Http(nav.Uri) && nav.Uri != "about:blank") nav.Cancel = true; };
                        e.NewWindow = web.CoreWebView2; popup.Show(MainWindow);
                    } finally { deferral.Complete(); }
                };
            }
            core.ProcessFailed += (s, e) => Log("webview-process " + e.ProcessFailedKind);
            if (view == MainView && File.Exists(Path.Combine(DataDir, "native-migration.json")) && !File.Exists(Path.Combine(DataDir, "native-migrated.flag"))) url = Origin + "/native-migrate.html";
            core.Navigate(url);
        }
        private async Task ImportLegacyStorage(CoreWebView2 core) {
            await StorageMigration.Import(core, DataDir, ClientDir); Log("migration-verified");
        }
        private async Task UpdatePanelPalette() {
            if (PanelView == null || PanelView.IsDisposed || PanelView.CoreWebView2 == null) return;
            var raw = await PanelView.CoreWebView2.ExecuteScriptAsync("(()=>{document.documentElement.dataset.bosTheme=" + J.Encode(theme) + ";document.documentElement.dataset.nativeHost='true';const p=document.querySelector('.panel');return p?getComputedStyle(p).backgroundColor:'';})()");
            string color = Convert.ToString(J.Decode(raw));
            var match = System.Text.RegularExpressions.Regex.Match(color, @"^rgb\((\d+),\s*(\d+),\s*(\d+)\)$");
            if (match.Success && PanelWindow != null && !PanelWindow.IsDisposed) PanelWindow.BackColor = Color.FromArgb(int.Parse(match.Groups[1].Value), int.Parse(match.Groups[2].Value), int.Parse(match.Groups[3].Value));
        }
        private async Task UpdateMainPalette() {
            if (MainView.IsDisposed || MainView.CoreWebView2 == null) return;
            var raw = await MainView.CoreWebView2.ExecuteScriptAsync("getComputedStyle(document.body).backgroundColor");
            var match = System.Text.RegularExpressions.Regex.Match(Convert.ToString(J.Decode(raw)), @"^rgb\((\d+),\s*(\d+),\s*(\d+)\)$");
            if (match.Success) { MainWindow.BackColor = Color.FromArgb(int.Parse(match.Groups[1].Value), int.Parse(match.Groups[2].Value), int.Parse(match.Groups[3].Value)); MainView.DefaultBackgroundColor = MainWindow.BackColor; }
        }
        private void InitTray() {
            tray = new NotifyIcon { Icon = MainWindow.Icon ?? SystemIcons.Application, Text = "XM剪辑台", Visible = true };
            tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) OpenMain(); };
            var menu = new ContextMenuStrip();
            menu.Opening += (s, e) => {
                menu.Items.Clear(); menu.Items.Add("打开 XM剪辑台", null, (_s, _e) => OpenMain());
                menu.Items.Add((PetVisible ? "隐藏" : "显示") + PetName, null, async (_s, _e) => { try { await CompanionAction("toggle", null); } catch (Exception error) { Notify(error.Message); } });
                menu.Items.Add(new ToolStripSeparator());
                foreach (var pair in new[] { new[] { "批量水印中心（原生硬件加速）", "watermark" }, new[] { "剪映智能工作台", "jianying" }, new[] { "文案拆解与智能配乐", "workspace" }, new[] { "剪贴板句号守护", "period" } }) {
                    string target = pair[1]; menu.Items.Add(pair[0], null, (_s, _e) => { OpenMain(); Emit("bos:tray-navigate", target); });
                }
                menu.Items.Add(new ToolStripSeparator()); menu.Items.Add("检查版本更新", null, async (_s, _e) => { OpenMain(); await UpdateAction("check"); });
                menu.Items.Add("彻底退出 XM剪辑台", null, (_s, _e) => Quit());
            };
            tray.ContextMenuStrip = menu;
        }
        internal void Notify(string text) { Ui(() => { tray.BalloonTipTitle = "XM剪辑台"; tray.BalloonTipText = text; tray.ShowBalloonTip(4000); }); }
        private object WindowControl(WebView2 sender, string action) {
            var window = sender.FindForm() as StudioWindow;
            if (window == null) return null;
            if (action == "drag") window.Drag();
            else if (action == "min") window.WindowState = FormWindowState.Minimized;
            else if (action == "max") window.WindowState = window.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
            else if (action == "close") window.Close();
            return null;
        }
        internal async void Quit() {
            if (Exiting) return; Exiting = true; wakeTimer.Stop();
            try { await StopServices(); } catch (Exception error) { Log(error.Message); }
            tray.Visible = false; tray.Dispose(); foreach (var popup in popups.ToArray()) popup.Close();
            if (PanelWindow != null) PanelWindow.Dispose(); MainWindow.Dispose(); ExitThread();
        }
    }
    internal static class Program {
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
        [STAThread] static void Main(string[] args) {
            SetProcessDPIAware(); SetCurrentProcessExplicitAppUserModelID("com.xiaoma.editing-studio");
            System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12;
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            string profile;
            try { profile = DataPaths.Resolve(AppDomain.CurrentDomain.BaseDirectory, Environment.GetEnvironmentVariable("XM_NATIVE_USER_DATA_DIR")); }
            catch (Exception error) { MessageBox.Show("无法准备安装目录下的 data 文件夹。\n" + error.Message, "XM剪辑台"); Environment.ExitCode = 1; return; }
            if (args.Contains("--verify-migration")) { Application.Run(new MigrationVerifier(profile)); return; }
            string identity = J.Hash(profile.ToLowerInvariant()).Substring(0, 24); bool owner;
            using (var mutex = new Mutex(true, "Local\\XMEditingStudioNative_" + identity, out owner))
            using (var wake = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\XMEditingStudioNativeWake_" + identity)) {
                if (!owner) { wake.Set(); return; }
                try { Application.Run(new StudioHost(profile, wake)); }
                catch (Exception error) { File.AppendAllText(Path.Combine(profile, "startup-native.log"), error.ToString()); MessageBox.Show(error.Message, "XM剪辑台启动失败"); }
                finally { mutex.ReleaseMutex(); }
            }
        }
    }
}
