using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace XM.Native {
    // A page may finish executing after it was hidden, navigated or cancelled.
    // Keep these lifetimes separate from geometry-only layout updates.
    internal sealed class WebAIInputGate {
        private sealed class Pending { internal int Epoch; internal bool Cancelled; }
        private readonly Dictionary<string, Pending> pending = new Dictionary<string, Pending>();
        private int epoch;
        internal void Invalidate() { ++epoch; }
        internal void Cancel(string id) { Pending item; if (pending.TryGetValue(id, out item)) item.Cancelled = true; }
        internal async Task<object> Run(string id, Func<Task<object>> execute, Func<bool> available, Func<Action, Task> enter) {
            if (string.IsNullOrEmpty(id) || pending.ContainsKey(id)) throw new Exception("无效的网页请求编号。");
            var item = new Pending { Epoch = epoch }; pending.Add(id, item);
            Action check = () => {
                if (item.Cancelled || item.Epoch != epoch || !available()) throw new OperationCanceledException("网页操作已中断或页面已切换。");
            };
            try {
                check(); var result = await execute(); check();
                if (J.Str(result, "state") != "enter") return result;
                await enter(check); check(); return J.Obj("state", "sent");
            } finally { pending.Remove(id); }
        }
        internal static async Task SendEnter(CoreWebView2 core, Action check) {
            // Target this browser only. Global SendKeys steals focus and can leave
            // Chromium's hidden typing cursor on the main workbench after a task.
            check();
            Exception failure = null;
            try {
                await core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", "{\"type\":\"keyDown\",\"key\":\"Enter\",\"code\":\"Enter\",\"windowsVirtualKeyCode\":13,\"text\":\"\\r\"}");
            } catch (Exception error) { failure = error; }
            // Always release an already-pressed key, including cancellation
            // between the two calls; key-up does not submit another message.
            await core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", "{\"type\":\"keyUp\",\"key\":\"Enter\",\"code\":\"Enter\",\"windowsVirtualKeyCode\":13}");
            if (failure != null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
        }
    }

    internal static class BrowserInput {
        private static Point? lastPointer;
        [StructLayout(LayoutKind.Sequential)] private struct CursorInfo { internal int Size, Flags; internal IntPtr Cursor; internal Point Position; }
        [DllImport("user32.dll")] private static extern bool GetCursorInfo(ref CursorInfo info);
        [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern bool IsChild(IntPtr parent, IntPtr child);
        [DllImport("user32.dll")] private static extern IntPtr GetCapture();
        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SetCursor(IntPtr cursor);
        [DllImport("user32.dll")] private static extern IntPtr GetCursor();
        private static bool Owns(Control control, IntPtr handle) {
            return handle != IntPtr.Zero && !control.IsDisposed && control.IsHandleCreated && (handle == control.Handle || IsChild(control.Handle, handle));
        }
        internal static void Hide(Control page, Control main) {
            if (page.IsDisposed || !page.Visible) return;
            var window = main.FindForm();
            bool returnFocus = page.ContainsFocus && window != null && GetForegroundWindow() == window.Handle;
            if (Owns(page, GetCapture())) ReleaseCapture();
            page.Hide();
            if (returnFocus && main.Visible && main.CanFocus) main.Focus();
            RecoverCursor(main);
        }
        internal static bool RecoverCursor(Control main) {
            var info = new CursorInfo { Size = Marshal.SizeOf(typeof(CursorInfo)) };
            if (!GetCursorInfo(ref info)) return false;
            bool moved = lastPointer.HasValue && lastPointer.Value != info.Position;
            lastPointer = info.Position;
            if (main == null || main.IsDisposed || !main.IsHandleCreated || !main.Visible) return false;
            var window = main.FindForm();
            if (window == null || !window.IsHandleCreated || GetForegroundWindow() != window.Handle) return false;
            if ((info.Flags & 2) != 0 || !Owns(main, WindowFromPoint(info.Position))) return false;
            // Preserve text/link/resize cursors and Windows' hide-while-typing or
            // touch suppression. Only repair a missing cursor on our local page.
            if (GetCapture() != IntPtr.Zero) return false;
            if ((info.Flags & 1) != 0 && info.Cursor != IntPtr.Zero) return false;
            if (GetCursor() != IntPtr.Zero && !moved) return false;
            SetCursor(Cursors.Default.Handle); return true;
        }
    }
}
