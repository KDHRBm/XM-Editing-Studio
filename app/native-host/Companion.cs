using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private LayeredAnimationWindow animationWindow;
        private Form animationSourceWindow;
        private WebView2 animationView;
        private Task animationOpening;
        private readonly Timer animationFrameTimer = new Timer { Interval = 40 };
        private readonly Timer animationPositionTimer = new Timer { Interval = 250 };
        private readonly Timer panelPositionTimer = new Timer { Interval = 250 };
        private readonly Random animationRandom = new Random();
        private string lastInteractionId;
        private bool animationFrameBusy;
        private bool animationWanted;
        private Dictionary<string, object> animationSettings;
        private bool PetVisible { get { return animationWindow != null && !animationWindow.IsDisposed && animationWindow.Visible; } }
        private string PetName { get { return "大肥鱼"; } }

        private void InitCompanion() {
            animationSettings = J.Obj("size", "normal", "scale", 100, "motion", true, "selfTalk", true, "talkInterval", 90, "bubbleBorderColor", "#FFB6C1", "bubbleX", 50, "bubbleY", 0, "phrases", new[] { "休息一下，下一集会更顺手。", "记得检查刚导出的成片。", "好音乐会让剧情更有力量。" });
            try {
                var saved = J.Map(J.Read(Path.Combine(DataDir, "companion-settings.json"), null));
                foreach (var pair in saved)
                    if (animationSettings.ContainsKey(pair.Key)) animationSettings[pair.Key] = pair.Value;
                if (!saved.ContainsKey("scale")) animationSettings["scale"] = J.Str(saved, "size", "normal") == "small" ? 75 : J.Str(saved, "size", "normal") == "large" ? 130 : 100;
            } catch (Exception error) { Log(error.Message); }
            animationPositionTimer.Tick += (s, e) => { animationPositionTimer.Stop(); SaveAnimationPosition(); };
            panelPositionTimer.Tick += (s, e) => { panelPositionTimer.Stop(); SavePanelBounds(); };
        }

        private void SaveAnimationPosition() {
            if (animationWindow != null && !animationWindow.IsDisposed)
                J.Save(Path.Combine(DataDir, "companion-animation-position.json"), J.Obj("x", animationWindow.Left, "y", animationWindow.Top));
        }

        private void SavePanelBounds() {
            if (PanelWindow != null && !PanelWindow.IsDisposed)
                J.Save(Path.Combine(DataDir, "jianying-floating-bounds.json"), J.Obj("x", PanelWindow.Left, "y", PanelWindow.Top, "width", PanelWindow.Width, "height", PanelWindow.Height));
        }

        private Point PetPanelLocation() {
            var bounds = animationWindow.VisibleBounds;
            if (bounds.IsEmpty) bounds = new Rectangle(animationWindow.Width / 4, animationWindow.Height / 4, animationWindow.Width / 2, animationWindow.Height / 2);
            int petLeft = animationWindow.Left + bounds.Left, petRight = animationWindow.Left + bounds.Right;
            int petBottom = animationWindow.Top + bounds.Bottom;
            var area = Screen.FromPoint(new Point((petLeft + petRight) / 2, petBottom)).WorkingArea;
            int x = petLeft - PanelWindow.Width - 12;
            if (x < area.Left && area.Right - petRight >= PanelWindow.Width + 12) x = petRight + 12;
            x = Math.Max(area.Left, Math.Min(area.Right - PanelWindow.Width, x));
            int y = Math.Max(area.Top, Math.Min(area.Bottom - PanelWindow.Height, petBottom - PanelWindow.Height));
            return new Point(x, y);
        }

        private void FollowPetPanel() {
            if (!PetVisible || PanelWindow == null || PanelWindow.IsDisposed || !PanelWindow.Visible) return;
            var position = PetPanelLocation();
            if (PanelWindow.Location != position) PanelWindow.Location = position;
        }

        private void PlayRandomInteraction() {
            if (!animationWanted || animationView == null || animationView.CoreWebView2 == null) return;
            var choices = AnimationList().Where(item => new[] { "click", "random", "turn", "move" }.Contains(J.Str(item, "category")))
                .Select(item => J.Str(item, "id")).Where(id => id.Length > 0).ToArray();
            if (choices.Length == 0) return;
            var fresh = choices.Where(id => id != lastInteractionId).ToArray();
            lastInteractionId = (fresh.Length > 0 ? fresh : choices)[animationRandom.Next(fresh.Length > 0 ? fresh.Length : choices.Length)];
            Emit("bos:companion-play", lastInteractionId, animationView);
        }

        private object[] AnimationList() {
            return J.Arr(J.Read(Path.Combine(ClientDir, "companion-animations", "manifest.json"), new object[0]));
        }

        private async Task<object> BroadcastPet() {
            var state = J.Obj("visible", PetVisible, "active", animationWanted, "panelOpen", PanelWindow != null && !PanelWindow.IsDisposed && PanelWindow.Visible,
                "settings", animationSettings, "native", J.Obj("ready", AnimationList().Length > 0, "animationCount", AnimationList().Length));
            Emit("bos:companion-state", state);
            if (PanelView != null) Emit("bos:companion-state", state, PanelView);
            if (animationView != null) Emit("bos:companion-state", state, animationView);
            return await Task.FromResult(state);
        }

        private async Task OpenAnimation() {
            if (animationOpening != null) { await animationOpening; return; }
            animationOpening = OpenAnimationCore();
            try { await animationOpening; } finally { animationOpening = null; }
        }

        private async Task OpenAnimationCore() {
            animationWanted = true;
            if (animationWindow != null && !animationWindow.IsDisposed) { animationWindow.Show(); animationWindow.BringToFront(); FollowPetPanel(); return; }
            if (AnimationList().Length == 0) throw new Exception("安装包中缺少桌面动画。");
            animationWindow = new LayeredAnimationWindow();
            animationWindow.Size = AnimationSize();
            var saved = J.Read(Path.Combine(DataDir, "companion-animation-position.json"), null);
            var area = Screen.PrimaryScreen.WorkingArea;
            int x = (int)J.Num(saved, "x", area.Right - animationWindow.Width - 24), y = (int)J.Num(saved, "y", area.Bottom - animationWindow.Height - 24);
            animationWindow.Location = animationWindow.ConstrainForPeek(new Point(x, y), area);
            animationWindow.Move += (s, e) => { FollowPetPanel(); animationPositionTimer.Stop(); animationPositionTimer.Start(); };
            animationWindow.PetClicked += (s, e) => PlayRandomInteraction();
            animationWindow.PetCloseRequested += async (s, e) => {
                try {
                    if (PanelWindow != null) PanelWindow.Hide();
                    await CompanionAction("hide", null);
                } catch (Exception error) { Notify(error.Message); }
            };
            animationWindow.FormClosing += (s, e) => { if (!Exiting) { e.Cancel = true; animationWindow.Hide(); BroadcastPet(); } };
            animationWindow.DoubleClick += async (s, e) => { try { await OpenPetPanel(); } catch (Exception error) { Notify(error.Message); } };
            animationSourceWindow = new Form { FormBorderStyle = FormBorderStyle.None, ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Location = new Point(-32000, -32000), Size = animationWindow.Size };
            animationView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
            animationSourceWindow.Controls.Add(animationView);
            animationSourceWindow.Show();
            animationView.CreateControl();
            await InitializeView(animationView, "main", Origin + "/companion-animation.html", true);
            animationFrameTimer.Tick -= RefreshAnimationFrame;
            animationFrameTimer.Tick += RefreshAnimationFrame;
            animationFrameTimer.Start();
        }

        private async void RefreshAnimationFrame(object sender, EventArgs args) {
            if (animationFrameBusy || !animationWanted || animationWindow == null || animationWindow.IsDisposed || animationView == null || animationView.CoreWebView2 == null) return;
            animationFrameBusy = true;
            try {
                using (var stream = new MemoryStream()) {
                    await animationView.CoreWebView2.CapturePreviewAsync(Microsoft.Web.WebView2.Core.CoreWebView2CapturePreviewImageFormat.Png, stream);
                    stream.Position = 0;
                    using (var bitmap = new Bitmap(stream)) {
                        animationWindow.SetFrame(bitmap);
                        if (animationWanted && !animationWindow.Visible) { animationWindow.Show(); FollowPetPanel(); await BroadcastPet(); }
                    }
                }
            } catch (Exception error) { if (Environment.GetEnvironmentVariable("XM_NATIVE_QA") == "1") Log("animation-frame " + error.Message); }
            finally { animationFrameBusy = false; }
        }

        private Size AnimationSize() {
            double scale = Math.Max(70, Math.Min(250, J.Num(animationSettings, "scale", 100))) / 100;
            return new Size((int)Math.Round(220 * scale), (int)Math.Round(270 * scale));
        }

        private async Task OpenPetPanel() {
            if (panelOpening != null) { await panelOpening; return; }
            panelOpening = OpenPetPanelCore();
            try { await panelOpening; } finally { panelOpening = null; }
        }

        private async Task OpenPetPanelCore() {
            if (PanelWindow == null || PanelWindow.IsDisposed) {
                PanelWindow = new StudioWindow(true) { Opacity = 1, Size = new Size(590, 700), MinimumSize = new Size(450, 400), CornerRadius = 8 };
                var saved = J.Read(Path.Combine(DataDir, "jianying-floating-bounds.json"), null);
                int width = (int)J.Num(saved, "width", 590), height = (int)J.Num(saved, "height", 700);
                PanelWindow.Size = new Size(Math.Max(450, width), Math.Max(400, height));
                var area = Screen.FromPoint(PetVisible ? animationWindow.Location : Cursor.Position).WorkingArea;
                int near = area.Right - PanelWindow.Width - 24;
                int x = (int)J.Num(saved, "x", near), y = (int)J.Num(saved, "y", area.Bottom - PanelWindow.Height - 24);
                PanelWindow.Location = new Point(Math.Max(area.Left, Math.Min(area.Right - PanelWindow.Width, x)), Math.Max(area.Top, Math.Min(area.Bottom - PanelWindow.Height, y)));
                PanelWindow.Move += (s, e) => { panelPositionTimer.Stop(); panelPositionTimer.Start(); };
                PanelWindow.ResizeEnd += (s, e) => { FollowPetPanel(); SavePanelBounds(); };
                PanelWindow.FormClosing += (s, e) => { if (!Exiting) { e.Cancel = true; PanelWindow.Hide(); BroadcastPet(); } };
                PanelView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = PanelWindow.BackColor };
                PanelWindow.Controls.Add(PanelView);
                var handle = PanelWindow.Handle; PanelView.CreateControl();
                await InitializeView(PanelView, "main", Origin + "/index.html?floating=jianying", true);
            }
            if (PanelWindow.WindowState == FormWindowState.Minimized) PanelWindow.WindowState = FormWindowState.Normal;
            if (PetVisible) PanelWindow.Location = PetPanelLocation();
            PanelWindow.Show(); PanelWindow.BringToFront();
            await BroadcastPet();
        }

        private async Task<object> CompanionAction(string action, object value) {
            if (action == "sync") return await BroadcastPet();
            if (action == "animations") return AnimationList();
            if (action == "show" || action == "toggle" && !PetVisible) {
                await OpenAnimation();
                if (animationView != null && animationView.CoreWebView2 != null) await animationView.CoreWebView2.ExecuteScriptAsync("document.getElementById('character')?.play().catch(() => {})");
            } else if (action == "hide" || action == "toggle") {
                animationWanted = false;
                if (animationWindow != null) animationWindow.Hide();
                if (animationView != null && animationView.CoreWebView2 != null) await animationView.CoreWebView2.ExecuteScriptAsync("document.getElementById('character')?.pause()");
            }
            else if (action == "panel") {
                bool open = Equals(value, true) || Equals(value, "toggle") && (PanelWindow == null || !PanelWindow.Visible);
                if (open) {
                    await OpenAnimation();
                    if (animationView != null && animationView.CoreWebView2 != null) await animationView.CoreWebView2.ExecuteScriptAsync("document.getElementById('character')?.play().catch(() => {})");
                    await OpenPetPanel();
                } else if (PanelWindow != null) PanelWindow.Hide();
            } else if (action == "play") {
                string id = Convert.ToString(value);
                if (!AnimationList().Any(item => J.Str(item, "id") == id)) throw new Exception("找不到该动画。");
                await OpenAnimation(); Emit("bos:companion-play", id, animationView);
            } else if (action == "preview-bubble") {
                var preview = J.Map(value);
                double x = J.Num(value, "bubbleX", -1), y = J.Num(value, "bubbleY", -1);
                if (!preview.ContainsKey("bubbleX") || !preview.ContainsKey("bubbleY") || x < 0 || x > 100 || y < 0 || y > 100)
                    throw new Exception("气泡位置须在 0% 到 100% 之间。");
                if (animationView != null) Emit("bos:companion-preview-bubble", J.Obj("bubbleX", x, "bubbleY", y), animationView);
                return null;
            } else if (action == "update-settings") {
                var values = J.Map(value);
                if (values.ContainsKey("scale")) {
                    double scale = J.Num(value, "scale", -1);
                    if (scale < 70 || scale > 250) throw new Exception("动画大小须在 70% 到 250% 之间。");
                    animationSettings["scale"] = (int)Math.Round(scale);
                }
                if (values.ContainsKey("motion")) animationSettings["motion"] = J.Bool(value, "motion");
                if (values.ContainsKey("selfTalk")) animationSettings["selfTalk"] = J.Bool(value, "selfTalk");
                if (values.ContainsKey("talkInterval")) animationSettings["talkInterval"] = Math.Max(15, Math.Min(600, (int)J.Num(value, "talkInterval", 90)));
                if (values.ContainsKey("bubbleBorderColor")) {
                    string color = J.Str(value, "bubbleBorderColor");
                    if (!System.Text.RegularExpressions.Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$")) throw new Exception("气泡边缘颜色格式无效。");
                    animationSettings["bubbleBorderColor"] = color;
                }
                foreach (var key in new[] { "bubbleX", "bubbleY" }) {
                    if (!values.ContainsKey(key)) continue;
                    double position = J.Num(value, key, -1);
                    if (position < 0 || position > 100) throw new Exception("气泡位置须在 0% 到 100% 之间。");
                    animationSettings[key] = (int)Math.Round(position);
                }
                if (values.ContainsKey("phrases")) {
                    var phrases = J.Arr(J.Get(value, "phrases")).OfType<string>().Select(line => line.Trim()).Where(line => line.Length > 0).Take(30).Select(line => line.Substring(0, Math.Min(80, line.Length))).ToArray();
                    if (phrases.Length == 0) throw new Exception("请至少填写一句自言自语内容。");
                    animationSettings["phrases"] = phrases;
                }
                J.Save(Path.Combine(DataDir, "companion-settings.json"), animationSettings);
                if (values.ContainsKey("scale") && animationWindow != null) {
                    var oldSize = animationWindow.Size;
                    var oldBounds = animationWindow.VisibleBounds;
                    if (oldBounds.IsEmpty) oldBounds = new Rectangle(0, 0, oldSize.Width, oldSize.Height);
                    int center = animationWindow.Left + oldBounds.Left + oldBounds.Width / 2;
                    int bottom = animationWindow.Top + oldBounds.Bottom;
                    animationWindow.Size = AnimationSize();
                    animationWindow.RescaleVisibleBounds(oldSize);
                    animationSourceWindow.Size = animationWindow.Size;
                    var bounds = animationWindow.VisibleBounds;
                    var area = Screen.FromPoint(new Point(center, bottom)).WorkingArea;
                    animationWindow.Location = animationWindow.ConstrainForPeek(new Point(center - bounds.Left - bounds.Width / 2, bottom - bounds.Bottom), area);
                }
            } else if (action == "focus-workbench") {
                if (PanelWindow != null) PanelWindow.Hide();
                OpenMain(); Emit("bos:tray-navigate", Equals(value, "providers") ? "providers" : "jianying");
            } else if (action == "reset-position") {
                if (animationWindow != null) {
                    var area = Screen.PrimaryScreen.WorkingArea;
                    var bounds = animationWindow.VisibleBounds;
                    if (bounds.IsEmpty) bounds = new Rectangle(0, 0, animationWindow.Width, animationWindow.Height);
                    animationWindow.Location = animationWindow.ConstrainForPeek(new Point(area.Right - bounds.Right - 24, area.Bottom - bounds.Bottom - 24), area);
                    animationWindow.Show(); FollowPetPanel();
                }
                else await OpenAnimation();
            } else throw new Exception("未知桌面动画操作：" + action);
            return await BroadcastPet();
        }

        private Task StopCompanion() {
            animationWanted = false;
            animationFrameTimer.Stop(); animationFrameTimer.Dispose();
            animationPositionTimer.Stop(); SaveAnimationPosition(); animationPositionTimer.Dispose();
            panelPositionTimer.Stop(); SavePanelBounds(); panelPositionTimer.Dispose();
            if (animationSourceWindow != null) animationSourceWindow.Dispose();
            if (animationWindow != null) animationWindow.Dispose();
            return Task.CompletedTask;
        }
    }
}
