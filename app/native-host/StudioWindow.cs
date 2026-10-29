using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace XM.Native {
    internal sealed class StudioWindow : RoundedWindow {
        private readonly bool floatingPanel;
        private Size normalSize;
        private bool nativeMaximized, restorePending;
        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr handle, int msg, IntPtr wparam, IntPtr lparam);
        [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr handle);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo { public Point Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }
        [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
        public StudioWindow(bool panel = false) {
            floatingPanel = panel;
            Text = "XM剪辑台"; FormBorderStyle = panel ? FormBorderStyle.None : FormBorderStyle.Sizable; AutoScaleMode = AutoScaleMode.Dpi;
            Size = panel ? new Size(350, 500) : new Size(1440, 920); MinimumSize = panel ? new Size(280, 320) : new Size(860, 600);
            StartPosition = FormStartPosition.CenterScreen; BackColor = Color.FromArgb(23, 24, 27);
            ShowInTaskbar = !panel; TopMost = panel; CornerRadius = panel ? 16 : 0;
            Padding = new Padding(6);
        }
        protected override CreateParams CreateParams {
            get {
                var parameters = base.CreateParams;
                // Windows Snap needs a resizable, maximizable top-level window.
                // NCCALCSIZE keeps its native caption/frame out of the client UI.
                if (!floatingPanel) parameters.Style |= 0x00C00000 | 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000;
                return parameters;
            }
        }
        private int ResizeEdge { get { using (var graphics = CreateGraphics()) return Math.Max(6, (int)Math.Ceiling(6 * graphics.DpiX / 96f)); } }
        private void UpdateResizeFrame() {
            // Keep a small native edge outside the WebView HWND: hit-testing the
            // Form alone cannot receive input covered by a browser child window.
            if (!IsHandleCreated) return;
            int edge = WindowState == FormWindowState.Maximized ? 0 : ResizeEdge;
            if (Padding.All != edge) Padding = new Padding(edge);
        }
        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); UpdateResizeFrame(); }
        protected override void OnSizeChanged(EventArgs e) {
            base.OnSizeChanged(e); UpdateResizeFrame();
            if (!floatingPanel && !nativeMaximized && !restorePending && WindowState == FormWindowState.Normal) normalSize = Size;
        }
        public void Drag() { ReleaseCapture(); SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero); }
        public void Palette(bool dark) { int v = dark ? 1 : 0; try { DwmSetWindowAttribute(Handle, 20, ref v, 4); int rounded = 2; DwmSetWindowAttribute(Handle, 33, ref rounded, 4); } catch {} }
        protected override void WndProc(ref Message m) {
            if (!floatingPanel && m.Msg == 0x05) { // WM_SIZE
                if (m.WParam.ToInt32() == 2) nativeMaximized = true;
                else if (m.WParam == IntPtr.Zero && nativeMaximized && !restorePending) {
                    nativeMaximized = false; restorePending = true;
                    var restoreSize = normalSize;
                    // WinForms adds its cached caption dimensions during restore.
                    // Undo that size adjustment after it finishes, keeping the
                    // position selected by Windows for drag-to-restore intact.
                    BeginInvoke(new Action(() => {
                        if (!IsDisposed && WindowState == FormWindowState.Normal && restoreSize.Width > 0) Size = restoreSize;
                        restorePending = false;
                        if (!IsDisposed && WindowState == FormWindowState.Normal) normalSize = Size;
                    }));
                }
            }
            if (!floatingPanel && m.Msg == 0x83) { // WM_NCCALCSIZE
                if (m.WParam != IntPtr.Zero && IsZoomed(Handle)) {
                    // Windows expands the outer resize frame beyond the monitor
                    // when maximizing. Keep the visible client inside its work area.
                    var work = Screen.FromHandle(Handle).WorkingArea;
                    var client = new NativeRect { Left = work.Left, Top = work.Top, Right = work.Right, Bottom = work.Bottom };
                    Marshal.StructureToPtr(client, m.LParam, false);
                }
                m.Result = IntPtr.Zero; return;
            }
            if (m.Msg == 0x24) {
                base.WndProc(ref m);
                var screen = Screen.FromHandle(m.HWnd); var limits = (MinMaxInfo)Marshal.PtrToStructure(m.LParam, typeof(MinMaxInfo));
                limits.MaxPosition = new Point(screen.WorkingArea.Left - screen.Bounds.Left, screen.WorkingArea.Top - screen.Bounds.Top);
                limits.MaxSize = new Point(screen.WorkingArea.Width, screen.WorkingArea.Height);
                Marshal.StructureToPtr(limits, m.LParam, false); return;
            }
            if (m.Msg == 0x84 && WindowState == FormWindowState.Normal) {
                Point p = PointToClient(new Point((short)(m.LParam.ToInt64() & 0xffff), (short)(m.LParam.ToInt64() >> 16)));
                int edge = ResizeEdge, corner = edge * 3;
                if (ClientRectangle.Contains(p)) {
                    bool l = p.X < edge, r = p.X >= ClientSize.Width - edge, t = p.Y < edge, b = p.Y >= ClientSize.Height - edge;
                    bool cl = p.X < corner, cr = p.X >= ClientSize.Width - corner, ct = p.Y < corner, cb = p.Y >= ClientSize.Height - corner;
                    int hit = (t && cl || l && ct) ? 13 : (t && cr || r && ct) ? 14 : (b && cl || l && cb) ? 16 : (b && cr || r && cb) ? 17 : t ? 12 : b ? 15 : l ? 10 : r ? 11 : 0;
                    if (hit != 0) { m.Result = new IntPtr(hit); return; }
                }
            }
            base.WndProc(ref m);
            if (m.Msg == 0x02E0) UpdateResizeFrame();
        }
    }
}
