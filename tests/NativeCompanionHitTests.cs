using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using XM.Native;

internal static class NativeCompanionHitTests {
    [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr region);
    [DllImport("gdi32.dll")] private static extern bool PtInRegion(IntPtr region, int x, int y);
    [DllImport("user32.dll")] private static extern int GetWindowRgn(IntPtr window, IntPtr region);

    [STAThread] private static int Main() {
        using (var window = new LayeredAnimationWindow())
        using (var frame = new Bitmap(100, 100)) {
            window.Size = frame.Size;
            using (var brush = new SolidBrush(Color.Red))
            using (var graphics = Graphics.FromImage(frame)) {
                graphics.Clear(Color.Transparent);
                graphics.FillRectangle(brush, 30, 20, 40, 60);
            }
            window.SetFrame(frame);
            IntPtr region = CreateRectRgn(0, 0, 0, 0);
            try {
                if (GetWindowRgn(window.Handle, region) == 0) throw new Exception("The character must have a window hit region.");
                if (PtInRegion(region, 5, 5)) throw new Exception("Transparent surroundings still capture the mouse.");
                if (!PtInRegion(region, 50, 50)) throw new Exception("Visible character pixels cannot be clicked.");
                if (PtInRegion(region, 75, 50)) throw new Exception("Pixels beside the character still capture the mouse.");
            } finally { DeleteObject(region); }
        }
        Console.WriteLine("PASS: only visible character pixels accept mouse input.");
        return 0;
    }
}
