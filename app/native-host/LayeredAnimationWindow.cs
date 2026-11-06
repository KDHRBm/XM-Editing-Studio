using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace XM.Native {
    internal sealed class LayeredAnimationWindow : Form {
        [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X, Y; public NativePoint(int x, int y) { X = x; Y = y; } }
        [StructLayout(LayoutKind.Sequential)] private struct NativeSize { public int Width, Height; public NativeSize(int width, int height) { Width = width; Height = height; } }
        [StructLayout(LayoutKind.Sequential, Pack = 1)] private struct Blend { public byte Operation, Flags, Opacity, AlphaFormat; }
        [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hwnd);
        [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr image);
        [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr image);
        [DllImport("user32.dll", SetLastError = true)] private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr screen, ref NativePoint position, ref NativeSize size, IntPtr source, ref NativePoint sourcePosition, uint colorKey, ref Blend blend, uint flags);
        [DllImport("user32.dll", SetLastError = true)] private static extern int SetWindowRgn(IntPtr hwnd, IntPtr region, bool redraw);

        private bool dragging, moved, ignoreClickUp;
        private Rectangle[] hitRuns = new Rectangle[0];
        private Point lastPointer;
        private Rectangle dragBounds;
        private readonly Timer clickTimer;
        private readonly ContextMenuStrip petMenu;
        public Rectangle VisibleBounds { get; private set; }
        public event EventHandler PetClicked;
        public event EventHandler PetCloseRequested;
        public LayeredAnimationWindow() {
            Text = "大肥鱼桌面动画";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            Cursor = Cursors.SizeAll;
            DoubleBuffered = true;
            clickTimer = new Timer { Interval = SystemInformation.DoubleClickTime };
            clickTimer.Tick += (s, e) => { clickTimer.Stop(); var handler = PetClicked; if (handler != null) handler(this, EventArgs.Empty); };
            petMenu = new ContextMenuStrip();
            petMenu.Items.Add("关闭桌宠", null, (s, e) => { var handler = PetCloseRequested; if (handler != null) handler(this, EventArgs.Empty); });
            ContextMenuStrip = petMenu;
        }
        protected override CreateParams CreateParams {
            get { var value = base.CreateParams; value.ExStyle |= 0x00080000 | 0x00000080; return value; }
        }
        public void SetFrame(Bitmap frame) {
            if (IsDisposed) return;
            using (var canvas = new Bitmap(Width, Height, PixelFormat.Format32bppArgb)) {
                using (var graphics = Graphics.FromImage(canvas)) {
                    graphics.Clear(Color.Transparent);
                    graphics.DrawImage(frame, new Rectangle(0, 0, Width, Height));
                }
                Rectangle[] runs;
                Rectangle bounds = AlphaBounds(canvas, out runs);
                if (!SameRuns(hitRuns, runs)) {
                    using (var path = new GraphicsPath()) {
                        if (runs.Length > 0) path.AddRectangles(runs);
                        using (var region = new Region(path))
                        using (var context = Graphics.FromImage(canvas)) {
                            IntPtr handle = region.GetHrgn(context);
                            if (SetWindowRgn(Handle, handle, false) == 0) {
                                DeleteObject(handle);
                                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                            }
                        }
                    }
                    hitRuns = runs;
                }
                if (!bounds.IsEmpty) {
                    VisibleBounds = bounds;
                    if (!dragging) {
                        var visibleCenter = new Point(Left + bounds.Left + bounds.Width / 2, Top + bounds.Top + bounds.Height / 2);
                        var constrained = ConstrainForPeek(Location, Screen.FromPoint(visibleCenter).WorkingArea);
                        if (Location != constrained) Location = constrained;
                    }
                }
                IntPtr screen = GetDC(IntPtr.Zero), memory = CreateCompatibleDC(screen), image = IntPtr.Zero, previous = IntPtr.Zero;
                try {
                    image = canvas.GetHbitmap(Color.FromArgb(0));
                    previous = SelectObject(memory, image);
                    var position = new NativePoint(Left, Top);
                    var size = new NativeSize(Width, Height);
                    var origin = new NativePoint(0, 0);
                    var blend = new Blend { Operation = 0, Flags = 0, Opacity = 255, AlphaFormat = 1 };
                    if (!UpdateLayeredWindow(Handle, screen, ref position, ref size, memory, ref origin, 0, ref blend, 2)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                } finally {
                    if (previous != IntPtr.Zero) SelectObject(memory, previous);
                    if (image != IntPtr.Zero) DeleteObject(image);
                    DeleteDC(memory);
                    ReleaseDC(IntPtr.Zero, screen);
                }
            }
        }
        private static bool SameRuns(Rectangle[] first, Rectangle[] second) {
            if (first.Length != second.Length) return false;
            for (int i = 0; i < first.Length; i++) if (first[i] != second[i]) return false;
            return true;
        }
        private static void AddRun(List<Rectangle> runs, Dictionary<long, int> previous, Dictionary<long, int> current, int start, int end, int y) {
            long key = ((long)start << 32) | (uint)(end - start);
            int index;
            if (previous.TryGetValue(key, out index)) {
                var rect = runs[index];
                rect.Height++;
                runs[index] = rect;
            } else {
                index = runs.Count;
                runs.Add(new Rectangle(start, y, end - start, 1));
            }
            current[key] = index;
        }
        private static Rectangle AlphaBounds(Bitmap bitmap, out Rectangle[] runs) {
            var area = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            var data = bitmap.LockBits(area, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try {
                var row = new byte[bitmap.Width * 4];
                var occupied = new List<Rectangle>();
                var previous = new Dictionary<long, int>();
                int left = bitmap.Width, top = bitmap.Height, right = -1, bottom = -1;
                for (int y = 0; y < bitmap.Height; y++) {
                    Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), row, 0, row.Length);
                    var current = new Dictionary<long, int>();
                    int start = -1;
                    for (int x = 0; x < bitmap.Width; x++) {
                        if (row[x * 4 + 3] <= 24) {
                            if (start >= 0) { AddRun(occupied, previous, current, start, x, y); start = -1; }
                            continue;
                        }
                        if (start < 0) start = x;
                        left = Math.Min(left, x); right = Math.Max(right, x);
                        top = Math.Min(top, y); bottom = Math.Max(bottom, y);
                    }
                    if (start >= 0) AddRun(occupied, previous, current, start, bitmap.Width, y);
                    previous = current;
                }
                runs = occupied.ToArray();
                return right < left ? Rectangle.Empty : Rectangle.FromLTRB(left, top, right + 1, bottom + 1);
            } finally { bitmap.UnlockBits(data); }
        }
        public Point ConstrainForPeek(Point desired, Rectangle area) {
            var bounds = dragBounds.IsEmpty ? VisibleBounds : dragBounds;
            if (bounds.IsEmpty) bounds = new Rectangle(Width / 4, Height / 4, Math.Max(1, Width / 2), Math.Max(1, Height / 2));
            int visibleX = Math.Min(28, Math.Max(1, bounds.Width));
            int visibleY = Math.Min(28, Math.Max(1, bounds.Height));
            int minX = area.Left - bounds.Right + visibleX, maxX = area.Right - bounds.Left - visibleX;
            int minY = area.Top - bounds.Bottom + visibleY, maxY = area.Bottom - bounds.Top - visibleY;
            return new Point(Math.Max(minX, Math.Min(maxX, desired.X)), Math.Max(minY, Math.Min(maxY, desired.Y)));
        }
        public void RescaleVisibleBounds(Size previous) {
            if (VisibleBounds.IsEmpty || previous.Width == 0 || previous.Height == 0) return;
            VisibleBounds = new Rectangle(
                VisibleBounds.Left * Width / previous.Width,
                VisibleBounds.Top * Height / previous.Height,
                Math.Max(1, VisibleBounds.Width * Width / previous.Width),
                Math.Max(1, VisibleBounds.Height * Height / previous.Height));
        }
        protected override void OnMouseDown(MouseEventArgs e) {
            base.OnMouseDown(e);
            if (e.Button == MouseButtons.Right) clickTimer.Stop();
            if (e.Button != MouseButtons.Left) return;
            dragging = true; moved = false; lastPointer = MousePosition; dragBounds = VisibleBounds; Capture = true;
        }
        protected override void OnMouseMove(MouseEventArgs e) {
            base.OnMouseMove(e);
            if (!dragging) return;
            var pointer = MousePosition;
            if (!moved && Math.Abs(pointer.X - lastPointer.X) + Math.Abs(pointer.Y - lastPointer.Y) < 5) return;
            moved = true;
            int dx = pointer.X - lastPointer.X, dy = pointer.Y - lastPointer.Y;
            lastPointer = pointer;
            var area = Screen.FromPoint(pointer).WorkingArea;
            Location = ConstrainForPeek(new Point(Left + dx, Top + dy), area);
        }
        protected override void OnMouseUp(MouseEventArgs e) {
            base.OnMouseUp(e);
            if (e.Button == MouseButtons.Left) {
                dragging = false; Capture = false; dragBounds = Rectangle.Empty;
                if (ignoreClickUp) ignoreClickUp = false;
                else if (!moved) { clickTimer.Stop(); clickTimer.Start(); }
            }
        }
        protected override void OnDoubleClick(EventArgs e) {
            clickTimer.Stop(); ignoreClickUp = true;
            base.OnDoubleClick(e);
        }
        protected override void Dispose(bool disposing) {
            if (disposing) { clickTimer.Dispose(); petMenu.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
