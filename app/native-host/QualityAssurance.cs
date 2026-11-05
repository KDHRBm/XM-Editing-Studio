using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace XM.Native {
    internal sealed partial class StudioHost {
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hwnd, int message, IntPtr wparam, IntPtr lparam);
        [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hwnd, int message, IntPtr wparam, IntPtr lparam);
        [DllImport("user32.dll")] private static extern IntPtr ChildWindowFromPoint(IntPtr hwnd, Point point);
        private object QAWindow(Form window, object request) {
            string action = J.Str(request, "action");
            if (action == "size") window.Size = new Size((int)J.Num(request, "width"), (int)J.Num(request, "height"));
            if (action == "max") window.WindowState = FormWindowState.Maximized;
            if (action == "restore") window.WindowState = FormWindowState.Normal;
            if (action == "reopen") { window.Hide(); window.Show(); }
            int width = window.ClientSize.Width, height = window.ClientSize.Height;
            int edge = window.Padding.Left, inside = Math.Max(1, edge / 2), corner = Math.Max(10, edge * 2);
            var points = new[] { new Point(inside, height / 2), new Point(width - inside, height / 2), new Point(width / 2, inside), new Point(width / 2, height - inside), new Point(corner, inside), new Point(width - corner, inside), new Point(corner, height - inside), new Point(width - corner, height - inside) };
            var hits = new List<object>();
            foreach (var point in points) {
                var screen = window.PointToScreen(point);
                int hit = (int)SendMessage(window.Handle, 0x84, IntPtr.Zero, new IntPtr((screen.Y << 16) | (screen.X & 0xffff)));
                hits.Add(J.Obj("x", point.X, "y", point.Y, "hit", hit, "native", ChildWindowFromPoint(window.Handle, point) == window.Handle, "inside", window.Region == null || window.Region.IsVisible(point)));
            }
            return J.Obj("width", width, "height", height, "edge", edge, "state", window.WindowState.ToString(), "hits", hits, "background", window.BackColor.ToArgb());
        }
        private Timer qaTimer;
        private bool qaBusy;
        private void InitQA() {
            if (Environment.GetEnvironmentVariable("XM_NATIVE_QA") != "1") return;
            qaTimer = new Timer { Interval = 200 };
            qaTimer.Tick += async (s, e) => {
                string path = Path.Combine(DataDir, "qa-command.json");
                if (qaBusy || !File.Exists(path) || MainView.CoreWebView2 == null) return;
                qaBusy = true;
                string id = "";
                try {
                    var request = J.Read(path, null); File.Delete(path);
                    id = J.Str(request, "id"); string command = J.Str(request, "command"), script = J.Str(request, "script");
                    object result = null;
                    var view = J.Bool(request, "animation") ? animationView : J.Bool(request, "panel") ? PanelView : J.Bool(request, "progress") ? progressView : MainView;
                    if (command == "progress") { ShowProgress(J.Get(request, "state")); J.Save(Path.Combine(DataDir, "qa-result.json"), J.Obj("id", id, "value", true)); return; }
                    if (command == "native") { result = await Dispatch(MainView, J.Str(request, "action"), J.Map(J.Get(request, "payload"))); J.Save(Path.Combine(DataDir, "qa-result.json"), J.Obj("id", id, "value", J.Obj("result", result))); return; }
                    if (command == "pet-position") {
                        if (animationWindow == null) throw new Exception("Desktop animation is not open.");
                        var area = Screen.PrimaryScreen.WorkingArea;
                        var point = animationWindow.ConstrainForPeek(new Point((int)J.Num(request, "x"), (int)J.Num(request, "y")), area);
                        if (J.Bool(request, "apply")) animationWindow.Location = point;
                        var bounds = animationWindow.VisibleBounds;
                        result = J.Obj("x", point.X, "y", point.Y, "visibleLeft", point.X + bounds.Left, "visibleRight", point.X + bounds.Right,
                            "visibleTop", point.Y + bounds.Top, "visibleBottom", point.Y + bounds.Bottom,
                            "screenLeft", area.Left, "screenRight", area.Right, "panelLeft", PanelWindow == null ? 0 : PanelWindow.Left,
                            "panelRight", PanelWindow == null ? 0 : PanelWindow.Right);
                    }
                    else if (command == "pet-click") {
                        if (animationWindow == null || animationView == null) throw new Exception("Desktop animation is not open.");
                        var bounds = animationWindow.VisibleBounds;
                        int x = bounds.Left + bounds.Width / 2, y = bounds.Top + bounds.Height / 2;
                        IntPtr point = new IntPtr((y << 16) | (x & 0xffff));
                        PostMessage(animationWindow.Handle, 0x201, new IntPtr(1), point);
                        PostMessage(animationWindow.Handle, 0x202, IntPtr.Zero, point);
                        await Task.Delay(SystemInformation.DoubleClickTime + 200);
                        result = J.Decode(await animationView.CoreWebView2.ExecuteScriptAsync("document.getElementById('character')?.getAttribute('src')"));
                    }
                    else if (command == "pet-context") {
                        if (animationWindow == null || !animationWindow.Visible) throw new Exception("Desktop animation is not visible.");
                        var bounds = animationWindow.VisibleBounds;
                        int x = bounds.Left + bounds.Width / 2, y = bounds.Top + bounds.Height / 2;
                        IntPtr point = new IntPtr((y << 16) | (x & 0xffff));
                        PostMessage(animationWindow.Handle, 0x204, new IntPtr(2), point);
                        PostMessage(animationWindow.Handle, 0x205, IntPtr.Zero, point);
                        await Task.Delay(150);
                        result = J.Obj("menuVisible", animationWindow.ContextMenuStrip.Visible,
                            "item", animationWindow.ContextMenuStrip.Items[0].Text);
                    }
                    else if (command == "pet-close") {
                        if (animationWindow == null || animationWindow.ContextMenuStrip == null) throw new Exception("Desktop animation menu is not available.");
                        animationWindow.ContextMenuStrip.Items[0].PerformClick();
                        await Task.Delay(150);
                        result = J.Obj("petVisible", PetVisible, "panelVisible", PanelWindow != null && PanelWindow.Visible);
                    }
                    else if (command == "window") result = QAWindow(view.FindForm(), request);
                    else if (command == "sizing") {
                        var window = view.FindForm(); var handle = window.Handle;
                        int side = (int)J.Num(request, "side", 2), key = (int)J.Num(request, "key", 0x27);
                        var before = window.Size;
                        PostMessage(handle, 0x112, new IntPtr(0xF000 + side), IntPtr.Zero);
                        await Task.Delay(180);
                        for (int n = 0; n < 8; n++) { PostMessage(handle, 0x100, new IntPtr(key), IntPtr.Zero); PostMessage(handle, 0x101, new IntPtr(key), IntPtr.Zero); await Task.Delay(20); }
                        PostMessage(handle, 0x100, new IntPtr(0x0D), IntPtr.Zero);
                        await Task.Delay(180);
                        result = J.Obj("beforeWidth", before.Width, "beforeHeight", before.Height, "afterWidth", window.Width, "afterHeight", window.Height);
                    }
                    else if (command == "shape") {
                        var window = view.FindForm(); var shape = window.Region;
                        result = J.Obj("width", window.ClientSize.Width, "height", window.ClientSize.Height, "clipped", shape != null,
                            "topLeft", shape == null || shape.IsVisible(0, 0), "topRight", shape == null || shape.IsVisible(window.ClientSize.Width - 1, 0),
                            "bottomLeft", shape == null || shape.IsVisible(0, window.ClientSize.Height - 1), "bottomRight", shape == null || shape.IsVisible(window.ClientSize.Width - 1, window.ClientSize.Height - 1),
                            "center", shape == null || shape.IsVisible(window.ClientSize.Width / 2, window.ClientSize.Height / 2));
                    }
                    else if (command == "screen") {
                        var window = J.Bool(request, "animation") && animationWindow != null ? (Form)animationWindow : view.FindForm(); var rectangle = window.Bounds;
                        using (var bitmap = new Bitmap(rectangle.Width + 16, rectangle.Height + 16)) {
                            using (var graphics = Graphics.FromImage(bitmap)) graphics.CopyFromScreen(rectangle.Left - 8, rectangle.Top - 8, 0, 0, bitmap.Size);
                            bitmap.Save(Path.Combine(DataDir, id + ".png"), System.Drawing.Imaging.ImageFormat.Png);
                        }
                        result = true;
                    }
                    else if (command == "screenshot") { using (var file = File.Create(Path.Combine(DataDir, id + ".png"))) await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, file); result = true; }
                    else if (command == "quit") { J.Save(Path.Combine(DataDir, "qa-result.json"), J.Obj("id", id, "result", true)); qaTimer.Stop(); Quit(); return; }
                    else {
                        await view.CoreWebView2.ExecuteScriptAsync("window.__xmQA=undefined;Promise.resolve().then(async()=>{" + script + "}).then(result=>window.__xmQA={result},error=>window.__xmQA={error:String(error.stack||error)})");
                        for (int n = 0; n < 300; n++) { await Task.Delay(100); var raw = await view.CoreWebView2.ExecuteScriptAsync("window.__xmQA"); if (raw != "null") { result = J.Decode(raw); break; } }
                        if (result == null) throw new Exception("QA script timed out");
                    }
                    J.Save(Path.Combine(DataDir, "qa-result.json"), J.Obj("id", id, "value", result));
                } catch (Exception error) { J.Save(Path.Combine(DataDir, "qa-result.json"), J.Obj("id", id, "value", J.Obj("error", error.ToString()))); }
                finally { qaBusy = false; }
            }; qaTimer.Start();
        }
    }
}
