using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace XM.Native {
    internal sealed class ProgressCardWindow : RoundedWindow {
        [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr handle, int index);
        [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr handle, int index, int value);
        [DllImport("user32.dll")] private static extern bool SetWindowDisplayAffinity(IntPtr handle, uint affinity);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
        internal ProgressCardWindow() { FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true; BackColor = Color.FromArgb(27, 32, 41); Opacity = .98; CornerRadius = 18; }
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams { get { var value = base.CreateParams; value.ExStyle |= 0x08000000; return value; } }
        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); SetWindowDisplayAffinity(Handle, 0x11); }
        internal void Passive(bool value) { int style = GetWindowLong(Handle, -20); SetWindowLong(Handle, -20, value ? style | 0x20 : style & ~0x20); }
        internal void ShowInactive() { ShowWindow(Handle, 4); }
    }
    internal sealed partial class StudioHost {
        private ProgressCardWindow progressWindow;
        private WebView2 progressView;
        private Task progressOpening;
        private object currentProgress;
        private bool progressDismissed, progressSuppressed, progressReady;
        private bool webScanActive;
        private bool restorePanelAfterCapture;
        private async void HandleEngineEvent(Dictionary<string, object> message) {
            try {
                string name = J.Str(message, "event");
                if (name == "minimize") { MainWindow.WindowState = FormWindowState.Minimized; return; }
                if (name == "scan-progress" || name == "export-progress" || name == "recording-progress") {
                    string stage = J.Str(message, "stage"), id = J.Str(message, "id");
                    if (id.Length == 0 || stage != "preparing" && (J.Str(currentProgress, "id") != id || Terminal(currentProgress))) return;
                    message["operation"] = name == "export-progress" ? "export" : name == "recording-progress" ? "recording" : "scan";
                    if (Terminal(message)) {
                        Emit("bos:native-ai-cancel", null);
                        if (jyAiView != null && jyAiView != MainView) Emit("bos:native-ai-cancel", null, jyAiView);
                        if (name == "scan-progress") {
                            if (webScanActive && stage == "complete") Emit("bos:tray-navigate", "jianying");
                            webScanActive = false;
                        }
                    }
                    ShowProgress(message);
                    if (Terminal(message) && restorePanelAfterCapture) { restorePanelAfterCapture = false; await OpenPetPanel(); }
                    return;
                }
                if (name == "scan-capture" || name == "recording-capture") {
                    if (J.Str(message, "id") != J.Str(currentProgress, "id") || Terminal(currentProgress)) return;
                    progressSuppressed = true; if (progressWindow != null) progressWindow.Hide();
                    if (PanelWindow != null && PanelWindow.Visible) { restorePanelAfterCapture = true; PanelWindow.Hide(); }
                    await Task.Delay(160);
                    await jyEngine.Call(name == "scan-capture" ? "scan_capture_ready" : "recording_capture_ready", J.Obj("id", J.Str(message, "id"), "token", J.Str(message, "token"), "error", "")); return;
                }
                if (name == "ai") Emit("bos:native-ai", message, jyAiView == null || jyAiView.IsDisposed ? MainView : jyAiView);
            } catch (Exception error) { Notify(error.Message); }
        }
        private static bool Terminal(object state) { return new[] { "complete", "error", "cancelled" }.Contains(J.Str(state, "stage")); }
        private bool PassiveProgress { get { return new[] { "recording", "export" }.Contains(J.Str(currentProgress, "operation")) && !Terminal(currentProgress); } }
        private void BatchProgress(object value) {
            if (value == null) {
                if (J.Str(currentProgress, "operation") == "batch") { currentProgress = null; if (progressWindow != null) progressWindow.Hide(); }
                return;
            }
            if (currentProgress != null && J.Str(currentProgress, "operation") != "batch" && !Terminal(currentProgress)) return;
            string id = J.Str(value, "id"), status = J.Str(value, "status"), model = J.Str(value, "model");
            if (id.Length == 0 || id.Length > 160 || !new[] { "running", "paused", "error", "complete" }.Contains(status)) return;
            int total = Math.Max(1, Math.Min(200, (int)J.Num(value, "total")));
            int completed = Math.Max(0, Math.Min(total, (int)J.Num(value, "completed")));
            int active = Math.Max(0, Math.Min(total, (int)J.Num(value, "active")));
            int episode = Math.Max(0, (int)J.Num(value, "firstEpisode"));
            string stage = status == "paused" ? "cancelled" : status == "running" ? active > 0 ? "running" : "preparing" : status;
            string message = status == "running" ? active > 0 ? "正在分析第 " + episode + " 集 " + Math.Min(total, completed + 1) + "/" + total : "正在准备下一批 · 已完成 " + completed + "/" + total
                : status == "complete" ? "剧本分析完成，已保存 " + completed + "/" + total + " 集" : status == "paused" ? "分析已中断，已完成 " + completed + "/" + total + " 集" : "分析未完成，已完成 " + completed + "/" + total + " 集";
            ShowProgress(J.Obj("id", id, "operation", "batch", "stage", stage, "message", message, "model", model.Length > 80 ? model.Substring(0, 80) : model, "total", total, "completed", completed, "startedAt", J.Num(value, "startedAt", J.Now())));
        }
        private async void ShowProgress(object state) {
            bool fresh = J.Str(state, "id") != J.Str(currentProgress, "id"), wasTerminal = !fresh && Terminal(currentProgress);
            var copy = new Dictionary<string, object>(J.Map(state)); copy["startedAt"] = fresh ? J.Num(state, "startedAt", J.Now()) : J.Num(currentProgress, "startedAt", J.Now()); if (Terminal(state)) copy["finishedAt"] = J.Now(); currentProgress = copy;
            if (fresh || Terminal(state)) progressDismissed = false;
            progressSuppressed = false;
            try {
                if (progressOpening == null && (progressWindow == null || progressWindow.IsDisposed)) progressOpening = CreateProgressWindow();
                if (progressOpening != null) await progressOpening;
                if (Exiting) return;
                var area = Screen.FromControl(MainWindow).WorkingArea;
                int width = Math.Min(366, area.Width - 24), height = Math.Min(J.Str(currentProgress, "operation") == "recording" ? 280 : J.Str(currentProgress, "operation") == "export" ? 260 : 236, area.Height - 24);
                var preferred = new Rectangle(area.Right - width - 12, area.Bottom - height - 12, width, height); var selected = preferred; bool found = false;
                var avoid = J.Arr(J.Get(currentProgress, "avoid")).Select(J.Arr).Where(x => x.Length == 2).Select(x => new Point(Convert.ToInt32(x[0]), Convert.ToInt32(x[1]))).ToArray();
                for (int x = preferred.X; x >= area.Left + 12 && !found; x -= width + 12) for (int y = preferred.Y; y >= area.Top + 12; y -= 48) { var bounds = new Rectangle(x, y, width, height); if (!avoid.Any(p => Rectangle.Inflate(bounds, 120, 80).Contains(p))) { selected = bounds; found = true; break; } }
                progressWindow.Bounds = selected; progressWindow.Passive(PassiveProgress); Emit("bos:scan-card-progress", currentProgress, progressView);
                if (progressReady && !progressDismissed && !progressSuppressed) progressWindow.ShowInactive();
                if (Terminal(state) && !wasTerminal) Notify(J.Str(state, "message"));
            } catch (Exception error) { Log("progress-card " + error.Message); }
        }
        private async Task CreateProgressWindow() {
            progressReady = false;
            progressWindow = new ProgressCardWindow(); progressView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent }; progressWindow.Controls.Add(progressView);
            // Create handles without activating or displaying before the page is ready.
            var handle = progressWindow.Handle; progressView.CreateControl();
            await InitializeView(progressView, "main", Origin + "/jianying-scan/index.html", true);
        }
        private async Task<object> ProgressAction(string action) {
            if (action == "state") return currentProgress;
            if (J.Str(currentProgress, "operation") == "batch") {
                if (action == "stop") { Emit("bos:batch-analysis-stop", null); return null; }
                progressDismissed = true; if (progressWindow != null) progressWindow.Hide();
                if (Terminal(currentProgress)) Emit("bos:batch-analysis-dismiss", null);
                if (action == "open") { OpenMain(); Emit("bos:tray-navigate", "batch"); }
                return null;
            }
            if (action == "stop") { Emit("bos:native-ai-cancel", null); if (jyAiView != null && jyAiView != MainView) Emit("bos:native-ai-cancel", null, jyAiView); jyState = await jyEngine.Call("stop"); return jyState; }
            if (action == "reveal-web-ai") { OpenMain(); Emit("bos:tray-navigate", "webai"); Emit("bos:open-web-ai", "deepseek"); return null; }
            if (action == "open" && PassiveProgress) return null;
            progressDismissed = true; if (progressWindow != null) progressWindow.Hide(); if (action == "open") OpenMain(); return null;
        }
    }
}
