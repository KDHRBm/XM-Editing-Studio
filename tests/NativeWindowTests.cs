using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using XM.Native;

internal static class NativeWindowTests {
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr handle, int index);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr handle, int message, IntPtr wparam, IntPtr lparam);
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    static void Pump() { Application.DoEvents(); System.Threading.Thread.Sleep(50); Application.DoEvents(); }
    [STAThread] static int Main() {
        Application.EnableVisualStyles();
        using (var window = new StudioWindow()) using (var child = new Panel { Dock = DockStyle.Fill }) {
            window.Opacity = 0; window.ShowInTaskbar = false; window.Controls.Add(child); window.Show(); Pump();
            var work = Screen.FromHandle(window.Handle).WorkingArea;
            window.Bounds = new Rectangle(work.Left + 40, work.Top + 40, Math.Max(860, work.Width - 200), Math.Max(600, work.Height - 180)); Pump();
            var normal = window.Bounds;
            int style = GetWindowLong(window.Handle, -16);
            Check((style & 0x00040000) != 0 && (style & 0x00010000) != 0, "Windows Snap requires thick frame and maximize styles");
            Check((style & 0x00C00000) == 0x00C00000, "Windows caption semantics retained for snap and drag-restore");
            Check(window.ClientSize == window.Size, "native caption and border must remain invisible");
            SendMessage(window.Handle, 0x112, new IntPtr(0xF030), IntPtr.Zero); Pump();
            Check(window.WindowState == FormWindowState.Maximized, "native maximize command updates managed state");
            Check(window.RectangleToScreen(window.ClientRectangle) == work, "maximized client fills work area without covering taskbar: actual=" + window.RectangleToScreen(window.ClientRectangle) + ", expected=" + work);
            Check(window.Padding.All == 0 && child.Bounds == window.ClientRectangle, "top and bottom content expand with maximized window");
            SendMessage(window.Handle, 0x112, new IntPtr(0xF120), IntPtr.Zero); Pump();
            Check(window.WindowState == FormWindowState.Normal && window.Bounds == normal, "restore returns to previous size and position: actual=" + window.Bounds + ", expected=" + normal);
            Check(window.Padding.All >= 6 && child.Bottom == window.ClientSize.Height - window.Padding.Bottom, "restored bottom follows client layout and resize edge remains usable");
            var top = new Point(window.Left + window.Width / 2, window.Top + 1);
            SendMessage(window.Handle, 0xA3, new IntPtr(12), new IntPtr((top.Y << 16) | (top.X & 0xffff))); Pump();
            Check(window.Top == work.Top && window.Bottom == work.Bottom, "native top-border double click stretches top and bottom to work area");
            Check(window.Width == normal.Width, "vertical stretch preserves width");
            Check(child.Bottom == window.ClientSize.Height - window.Padding.Bottom, "content follows vertical stretch");
            window.Close();
        }
        using (var panel = new StudioWindow(true)) {
            int style = GetWindowLong(panel.Handle, -16);
            Check((style & 0x00C00000) == 0, "floating pet panel keeps existing borderless behavior");
        }
        Console.WriteLine("PASS: native snap styles, frameless client, maximize/restore, vertical stretch and content layout.");
        return 0;
    }
}
