using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;

internal sealed partial class JianYingEngine
{
    private Dictionary<string, string> _buttonImages = new Dictionary<string, string>();
    private Dictionary<string, string> _recordingImages;
    private Dictionary<string, int[]> _coordinateFrames = new Dictionary<string, int[]>();
    private Dictionary<string, int[]> _recordingFrames;
    // Capture dependencies also allow regression tests without moving the user's mouse.
    private Func<Point> _readCursor = ReadCursor;
    private Func<Point, int[]> _recordingWindow = RecordingWindow;
    private Func<Point, string> _captureButton = CaptureButtonImage;

    private static Point ReadCursor()
    {
        NativeWin32.POINT p;
        if (!NativeWin32.GetCursorPos(out p)) throw new InvalidOperationException("无法获取鼠标位置。");
        return new Point(p.X, p.Y);
    }

    private static int[] WindowFrame(IntPtr handle)
    {
        NativeWin32.RECT r;
        if (handle == IntPtr.Zero || NativeWin32.IsIconic(handle) || !NativeWin32.GetWindowRect(handle, out r))
            throw new InvalidOperationException("剪映窗口不可见，请返回剪映后重试。");
        return new[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, NativeWin32.WindowDpi(handle) };
    }

    private static int[] RecordingWindow(Point point)
    {
        IntPtr handle = NativeWin32.WindowFromPoint(new NativeWin32.POINT { X = point.X, Y = point.Y });
        if (!NativeWin32.IsJianyingWindow(handle)) throw new InvalidOperationException("鼠标必须放在剪映按钮上，不能放在进度卡或其他程序上。");
        return WindowFrame(NativeWin32.GetAncestor(handle, 2));
    }

    private static Point TranslatePoint(Point point, int[] before, int[] after)
    {
        if (before == null || after == null || before.Length != 5 || after.Length != 5 ||
            Math.Abs(before[2] - after[2]) > 2 || Math.Abs(before[3] - after[3]) > 2 || before[4] != after[4])
            throw new InvalidOperationException("剪映窗口大小或显示缩放已变化，请重新扫描草稿；导出按钮请按当前窗口重新录制。");
        return new Point(point.X + after[0] - before[0], point.Y + after[1] - before[1]);
    }

    private Point ResolveButton(string step, Dictionary<string, int[]> coords)
    {
        int[] p = coords[step];
        var point = new Point(p[0], p[1]);
        int[] frame;
        if (_coordinateFrames.TryGetValue(step, out frame))
        {
            RequireJianyingForeground();
            IntPtr fg = NativeWin32.GetAncestor(NativeWin32.GetForegroundWindow(), 2);
            int[] currentFrame = WindowFrame(fg);
            if (Math.Abs(frame[2] - currentFrame[2]) <= 8 && Math.Abs(frame[3] - currentFrame[3]) <= 8 && frame[4] == currentFrame[4])
            {
                point = new Point(point.X + currentFrame[0] - frame[0], point.Y + currentFrame[1] - frame[1]);
            }
            else
            {
                try
                {
                    IntPtr match = NativeWin32.FindWindowBySize(frame[2], frame[3]);
                    if (match != IntPtr.Zero)
                    {
                        int[] matchedFrame = WindowFrame(match);
                        point = new Point(point.X + matchedFrame[0] - frame[0], point.Y + matchedFrame[1] - frame[1]);
                    }
                }
                catch { }
            }
        }
        return point;
    }

    private static void ValidateRecordedStep(string step, Point point, Dictionary<string, int[]> coords)
    {
        int[] previous;
        if (step == "draft_close" && coords.TryGetValue("close_btn", out previous) && previous != null &&
            Math.Abs(point.X - previous[0]) <= 3 && Math.Abs(point.Y - previous[1]) <= 3)
            throw new InvalidOperationException("关闭草稿与关闭导出界面的坐标相同。请先点击关闭导出界面，再将鼠标移到关闭草稿/返回首页按钮录制。");
    }

    private void ValidateExportCoordinates(string mode)
    {
        if (mode == "wait_close") ValidateRecordedStep("draft_close", new Point(_coords["draft_close"][0], _coords["draft_close"][1]), _coords);
    }

    private static Bitmap CaptureArea(Rectangle area)
    {
        if (!System.Windows.Forms.SystemInformation.VirtualScreen.Contains(area)) throw new InvalidOperationException("识别位置超出屏幕，请重新录制或扫描。");
        var bitmap = new Bitmap(area.Width, area.Height, PixelFormat.Format24bppRgb);
        try { using (var g = Graphics.FromImage(bitmap)) g.CopyFromScreen(area.Location, Point.Empty, area.Size); return bitmap; }
        catch { bitmap.Dispose(); throw; }
    }

    private static string CaptureButtonImage(Point point)
    {
        // Include the button's text and outline, so dark backgrounds alone cannot match.
        var screen = System.Windows.Forms.SystemInformation.VirtualScreen;
        int halfWidth = Math.Min(40, Math.Min(point.X - screen.Left, screen.Right - point.X - 1));
        int halfHeight = Math.Min(12, Math.Min(point.Y - screen.Top, screen.Bottom - point.Y - 1));
        if (halfWidth < 4 || halfHeight < 4) throw new InvalidOperationException("请将鼠标放到按钮中间再按 F8。");
        using (var bitmap = CaptureArea(new Rectangle(point.X - halfWidth, point.Y - halfHeight, halfWidth * 2 + 1, halfHeight * 2 + 1)))
        using (var stream = new MemoryStream())
        {
            if (!MatchButton(bitmap, bitmap).HasValue) throw new InvalidOperationException("没有录到清晰按钮，请把鼠标移到按钮文字或图标中心再按 F8。");
            bitmap.Save(stream, ImageFormat.Png); return Convert.ToBase64String(stream.ToArray());
        }
    }

    private static double Grey(Color c) { return c.R * .299 + c.G * .587 + c.B * .114; }

    private static Point? MatchButton(Bitmap template, Bitmap search)
    {
        // Normalized correlation tolerates hover highlights, but rejects flat patches.
        var samples = new List<Tuple<int, int, double>>(); double mean = 0;
        for (int y = 1; y < template.Height; y += 2) for (int x = 1; x < template.Width; x += 2)
        { double v = Grey(template.GetPixel(x, y)); samples.Add(Tuple.Create(x, y, v)); mean += v; }
        if (samples.Count == 0) return null;
        mean /= samples.Count;
        double variance = samples.Sum(s => (s.Item3 - mean) * (s.Item3 - mean));
        if (variance / samples.Count < 100) return null;
        double best = .78; Point? result = null; double nearest = double.MaxValue;
        for (int oy = 0; oy <= search.Height - template.Height; oy += 2)
        for (int ox = 0; ox <= search.Width - template.Width; ox += 2)
        {
            double sum = 0, sum2 = 0, cross = 0;
            foreach (var s in samples) { double v = Grey(search.GetPixel(ox + s.Item1, oy + s.Item2)); sum += v; sum2 += v * v; cross += (s.Item3 - mean) * v; }
            double other = sum2 - sum * sum / samples.Count;
            if (other / samples.Count < 100 || Math.Abs(sum / samples.Count - mean) > 55) continue;
            double score = cross / Math.Sqrt(variance * other);
            double distance = Math.Abs(ox - (search.Width - template.Width) / 2) + Math.Abs(oy - (search.Height - template.Height) / 2);
            if (score > best + .002 || score >= best && distance < nearest)
            { best = score; nearest = distance; result = new Point(ox + template.Width / 2, oy + template.Height / 2); }
        }
        return result;
    }

    private Point? LocateRecordedButton(string step, Point expected)
    {
        string encoded;
        if (!_buttonImages.TryGetValue(step, out encoded)) return null;
        using (var stream = new MemoryStream(Convert.FromBase64String(encoded)))
        using (var template = new Bitmap(stream))
        {
            if (template.Width > 200 || template.Height > 100) throw new InvalidOperationException("按钮图像模板无效，请重新录制。");
            var box = new Rectangle(expected.X - template.Width / 2 - 12, expected.Y - template.Height / 2 - 12, template.Width + 24, template.Height + 24);
            box.Intersect(System.Windows.Forms.SystemInformation.VirtualScreen);
            using (var search = CaptureArea(box))
            {
                var found = MatchButton(template, search);
                return found.HasValue ? (Point?)new Point(box.X + found.Value.X, box.Y + found.Value.Y) : null;
            }
        }
    }

    private static bool ButtonPatchReady(string mode, Bitmap patch, int[] targetColor)
    {
        int cyan = 0, bright = 0, dark = 0, matched = 0, total = 0;
        for (int y = 0; y < patch.Height; y += 2) for (int x = 0; x < patch.Width; x += 2)
        {
            Color c = patch.GetPixel(x, y); int value = Math.Max(c.R, Math.Max(c.G, c.B)); total++;
            if (targetColor != null && targetColor.Length == 3 &&
                Math.Abs(c.R - targetColor[0]) <= 35 && Math.Abs(c.G - targetColor[1]) <= 35 && Math.Abs(c.B - targetColor[2]) <= 35)
                matched++;
            if (c.R < 80 && c.G > 130 && c.B > 130) cyan++;
            if (value > 160) bright++; if (value < 100) dark++;
        }
        if (targetColor != null && matched >= Math.Max(3, total / 15)) return true;
        return mode == "return_home" ? cyan >= Math.Max(4, total / 10) : cyan == 0 && bright >= 4 && dark >= total / 4;
    }

    private static bool LegacyButtonReady(string mode, Bitmap patch)
    {
        return ButtonPatchReady(mode, patch, null);
    }

    private void ClickButton(string step, Dictionary<string, int[]> coords, int gen)
    {
        int[] p = coords[step];
        SafeClick(p[0], p[1], gen);
    }

    private void AvoidExportTarget(Point point, int gen)
    {
        lock (_lock)
        {
            if (_exportProgress == null) return;
            _exportProgress["avoid"] = new[] { new[] { point.X, point.Y } };
            EmitProgress(_exportProgress, "export-progress", "running", Convert.ToString(_exportProgress["message"]));
        }
        InterruptibleWait(.16, gen);
    }

    private void WaitForExportDialogClosed(Point previousButton, int gen)
    {
        if (!_buttonImages.ContainsKey("close_btn")) return;
        for (int n = 0; n < 20; n++)
        {
            CheckInterrupted(gen); RequireJianyingForeground();
            // The foreground can now be the editor rather than the modal; do not
            // translate the old dialog's coordinates against the editor's bounds.
            if (!LocateRecordedButton("close_btn", previousButton).HasValue) return;
            InterruptibleWait(.5, gen);
        }
        throw new InvalidOperationException("导出窗口尚未关闭，已暂停后续点击。请确认关闭按钮录制正确后重试。");
    }

    private void ExportPhase(string message)
    {
        lock (_lock) { Log(message); EmitProgress(_exportProgress, "export-progress", "running", message + " · F10 结束运行"); }
    }

    private void LoadAutomationTemplate(IDictionary data)
    {
        // Always reset optional fields: a legacy template must not inherit another one's images.
        _buttonImages = new Dictionary<string, string>(); _coordinateFrames = new Dictionary<string, int[]>();
        var images = data["button_images"] as IDictionary; var frames = data["coordinate_frames"] as IDictionary;
        foreach (string step in _coords.Keys)
        {
            if (images != null && images.Contains(step) && images[step] is string && ((string)images[step]).Length < 100000) _buttonImages[step] = (string)images[step];
            var values = frames == null ? null : frames[step] as IList;
            if (values != null && values.Count == 5) _coordinateFrames[step] = values.Cast<object>().Select(Convert.ToInt32).ToArray();
        }
    }
}
