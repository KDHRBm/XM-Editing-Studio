using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using XM.Native;

internal static class NativeBrowserInputTests {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr SetCursor(IntPtr cursor);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetCapture();
    [StructLayout(LayoutKind.Sequential)] struct CursorInfo { public int Size, Flags; public IntPtr Cursor; public Point Position; }
    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CursorInfo info);
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    static async Task Rejected(Task<object> pending) { try { await pending; throw new Exception("Stale input was accepted"); } catch (OperationCanceledException) {} }
    static async Task Gate() {
        var gate = new WebAIInputGate(); int sent = 0; bool visible = true;
        Func<Action, Task> send = check => { check(); ++sent; return Task.FromResult(0); };
        var old = new TaskCompletionSource<object>();
        var pending = gate.Run("old", () => old.Task, () => visible, send);
        gate.Invalidate(); old.SetResult(J.Obj("state", "enter")); await Rejected(pending);
        old = new TaskCompletionSource<object>(); pending = gate.Run("cancel", () => old.Task, () => visible, send);
        gate.Cancel("cancel"); old.SetResult(J.Obj("state", "enter")); await Rejected(pending);
        old = new TaskCompletionSource<object>(); pending = gate.Run("hidden", () => old.Task, () => visible, send);
        visible = false; old.SetResult(J.Obj("state", "enter")); await Rejected(pending); visible = true;
        Check(sent == 0, "Hide/switch/navigation/cancellation must never send delayed Enter");
        var result = await gate.Run("new", () => Task.FromResult<object>(J.Obj("state", "enter")), () => visible, send);
        Check(J.Str(result, "state") == "sent" && sent == 1, "New task survives cancellation of previous task");
        await gate.Run("read", () => Task.FromResult<object>(J.Obj("state", "done")), () => visible, send);
        Check(sent == 1, "Reads must never send keyboard input");
    }
    static async Task WebView(Form form) {
        using (var page = new WebView2 { Dock = DockStyle.Fill }) {
            form.Controls.Add(page);
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "profile"));
            await page.EnsureCoreWebView2Async(env);
            var loaded = new TaskCompletionSource<bool>();
            page.CoreWebView2.NavigationCompleted += (s, e) => loaded.TrySetResult(e.IsSuccess);
            page.CoreWebView2.NavigateToString("<input id='prompt'><script>window.events=[];prompt=document.getElementById('prompt');prompt.focus();prompt.addEventListener('keydown',e=>events.push([e.key,e.isTrusted]));</script>");
            Check(await loaded.Task, "Local WebView fixture loads");
            var before = GetForegroundWindow();
            await WebAIInputGate.SendEnter(page.CoreWebView2, () => {});
            var result = await page.CoreWebView2.ExecuteScriptAsync("JSON.stringify(window.events)");
            Check(Convert.ToString(J.Decode(result)) == "[[\"Enter\",true]]", "Browser must receive exactly one trusted Enter: " + result);
            Check(GetForegroundWindow() == before, "Targeted browser keys must not steal foreground focus");
            await Gate();
        }
    }
    static void Desktop() {
        var original = GetForegroundWindow(); var cursor = Cursor.Current;
        try {
            using (var form = new Form { ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, FormBorderStyle = FormBorderStyle.None })
            using (var main = new TextBox { Multiline = true, Dock = DockStyle.Fill })
            using (var remote = new TextBox { Multiline = true, Dock = DockStyle.Fill }) {
                var p = Cursor.Position; form.Bounds = new Rectangle(p.X - 100, p.Y - 70, 240, 180);
                form.Controls.Add(main); form.Controls.Add(remote); form.Show(); form.Activate(); SetForegroundWindow(form.Handle); Application.DoEvents();
                if (GetForegroundWindow() != form.Handle) { Console.WriteLine("SKIP foreground cursor test: Windows did not grant test-window foreground; no global input used to override it."); return; }
                remote.BringToFront(); remote.Focus(); remote.Capture = true;
                Check(remote.ContainsFocus, "AI fixture gets focus");
                BrowserInput.Hide(remote, main);
                Check(main.ContainsFocus && !remote.Capture && !remote.Visible, "Hiding AI returns focus and releases only its capture");
                SetCursor(Cursors.IBeam.Handle); Check(!BrowserInput.RecoverCursor(main) && Cursor.Current.Handle == Cursors.IBeam.Handle, "Text cursor remains intact");
                SetCursor(Cursors.Hand.Handle); Check(!BrowserInput.RecoverCursor(main) && Cursor.Current.Handle == Cursors.Hand.Handle, "Link cursor remains intact");
                SetCursor(Cursors.SizeWE.Handle); Check(!BrowserInput.RecoverCursor(main) && Cursor.Current.Handle == Cursors.SizeWE.Handle, "Resize cursor remains intact");
                SetCursor(IntPtr.Zero);
                var info = new CursorInfo { Size = Marshal.SizeOf(typeof(CursorInfo)) }; GetCursorInfo(ref info);
                string context = " foreground=" + GetForegroundWindow() + " form=" + form.Handle + " hit=" + WindowFromPoint(info.Position) + " main=" + main.Handle + " flags=" + info.Flags + " capture=" + GetCapture() + " point=" + info.Position + " bounds=" + main.RectangleToScreen(main.ClientRectangle);
                Check(BrowserInput.RecoverCursor(main) && Cursor.Current != null, "Missing local cursor is restored" + context);
                remote.Show(); remote.BringToFront(); SetCursor(IntPtr.Zero);
                Check(!BrowserInput.RecoverCursor(main), "Remote browser is outside the local repair surface");
                SetCursor(Cursors.Default.Handle);
                using (var other = new Form { ShowInTaskbar = false }) using (var input = new TextBox()) {
                    other.Controls.Add(input); other.Show(); other.Activate(); input.Focus(); Application.DoEvents();
                    BrowserInput.Hide(remote, main);
                    Check(GetForegroundWindow() == other.Handle && input.ContainsFocus, "Finishing in background never steals another window's focus");
                    Check(!BrowserInput.RecoverCursor(main), "No cursor changes outside XM");
                }
            }
        } finally { Cursor.Current = cursor ?? Cursors.Default; if (original != IntPtr.Zero) SetForegroundWindow(original); }
        Console.WriteLine("PASS native focus/capture handoff, missing cursor recovery, text/link/resize preservation, remote/other window isolation");
    }
    [STAThread] static int Main(string[] args) {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Application.EnableVisualStyles();
        if (Array.IndexOf(args, "--desktop") >= 0) { try { Desktop(); } catch (Exception error) { Console.WriteLine("FAIL: " + error.Message); return 1; } }
        using (var form = new Form { ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Location = new Point(-30000, -30000), Size = new Size(640, 480) }) {
            Exception failure = null;
            form.Shown += async (s, e) => { try { await WebView(form); } catch (Exception error) { failure = error; } finally { form.Close(); } };
            Application.Run(form);
            if (failure != null) { Console.Error.WriteLine(failure); return 1; }
        }
        Console.WriteLine("PASS native late input cancellation and trusted browser Enter without global keyboard/focus changes"); return 0;
    }
}
