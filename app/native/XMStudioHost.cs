using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace XMStudioHost
{
    internal static class Win32
    {
        public const int WM_NCLBUTTONDOWN = 0x00A1;
        public const int HTCAPTION = 0x0002;
        public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        public const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
        public const int DWMWA_BORDER_COLOR = 34;
        public const int DWMWA_SYSTEMBACKDROP_TYPE = 38;
        public const int DWMWA_NCRENDERING_POLICY = 2;
        public const uint ULW_ALPHA = 0x00000002;
        public const byte AC_SRC_OVER = 0x00;
        public const byte AC_SRC_ALPHA = 0x01;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; public POINT(int x, int y) { X = x; Y = y; } }

        [StructLayout(LayoutKind.Sequential)]
        public struct SIZE { public int CX; public int CY; public SIZE(int cx, int cy) { CX = cx; CY = cy; } }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        public struct BLENDFUNCTION
        {
            public byte BlendOp;
            public byte BlendFlags;
            public byte SourceConstantAlpha;
            public byte AlphaFormat;
        }

        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pptSrc, uint crKey, [In] ref BLENDFUNCTION pblend, uint dwFlags);

        [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll", ExactSpelling = true)]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern IntPtr CreateCompatibleDC(IntPtr hDC);

        [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll", ExactSpelling = true)]
        public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateRoundRectRgn(int x1, int y1, int x2, int y2, int cx, int cy);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteObject(IntPtr hObject);

        [DllImport("dwmapi.dll")]
        public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        public static void DisableBorderAndShadow(IntPtr handle)
        {
            try
            {
                int ncPolicy = 1; // DWMNCRP_DISABLED
                DwmSetWindowAttribute(handle, DWMWA_NCRENDERING_POLICY, ref ncPolicy, sizeof(int));
                int corner = 1; // DWMWCP_DONOTROUND
                DwmSetWindowAttribute(handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, sizeof(int));
                int borderNone = unchecked((int)0xFFFFFFFE); // DWMWA_COLOR_NONE
                DwmSetWindowAttribute(handle, DWMWA_BORDER_COLOR, ref borderNone, sizeof(int));
                int backdropNone = 1; // DWMSBT_NONE
                DwmSetWindowAttribute(handle, DWMWA_SYSTEMBACKDROP_TYPE, ref backdropNone, sizeof(int));
            }
            catch { }
        }

        public static void EnableRoundedAndDark(IntPtr handle, bool acrylic = false)
        {
            try
            {
                int dark = 1;
                DwmSetWindowAttribute(handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));
                int corner = 2; // DWMWCP_ROUND
                DwmSetWindowAttribute(handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, sizeof(int));
                if (acrylic)
                {
                    int backdrop = 3; // DWMSBT_TRANSIENTWINDOW (Acrylic)
                    DwmSetWindowAttribute(handle, DWMWA_SYSTEMBACKDROP_TYPE, ref backdrop, sizeof(int));
                }
            }
            catch { }
        }
    }

    internal sealed class JsonRpcChild : IDisposable
    {
        private readonly string _exePath;
        private readonly string _arguments;
        private Process _proc;
        private StreamWriter _utf8Writer;
        private readonly object _writeLock = new object();
        private int _seq;
        private readonly ConcurrentDictionary<int, TaskCompletionSource<Dictionary<string, object>>> _pending =
            new ConcurrentDictionary<int, TaskCompletionSource<Dictionary<string, object>>>();
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        public Action<Dictionary<string, object>> OnEvent;

        public JsonRpcChild(string exePath, string arguments = "")
        {
            _exePath = exePath;
            _arguments = arguments ?? "";
        }

        private void EnsureStarted()
        {
            if (_proc != null && !_proc.HasExited) return;
            var psi = new ProcessStartInfo
            {
                FileName = _exePath,
                Arguments = _arguments,
                WorkingDirectory = Path.GetDirectoryName(_exePath),
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                CreateNoWindow = true,
            };
            _proc = Process.Start(psi);
            // .NET Framework 4.x 的 StandardInput 默认使用系统 ANSI 代码页（中文系统为 GBK），
            // 而子进程按 UTF-8 读取，必须显式包装为无 BOM 的 UTF-8 写入器，否则中文路径会变成乱码。
            _utf8Writer = new StreamWriter(_proc.StandardInput.BaseStream, new UTF8Encoding(false)) { AutoFlush = true };
            ThreadPool.QueueUserWorkItem(_ => ReadLoop(_proc));
        }

        private void ReadLoop(Process p)
        {
            try
            {
                string line;
                while ((line = p.StandardOutput.ReadLine()) != null)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    Dictionary<string, object> msg = null;
                    try { msg = _json.Deserialize<Dictionary<string, object>>(line); } catch { continue; }
                    if (msg == null) continue;
                    if (msg.ContainsKey("event"))
                    {
                        var cb = OnEvent;
                        if (cb != null) { try { cb(msg); } catch { } }
                        continue;
                    }
                    if (msg.ContainsKey("id") && msg["id"] != null)
                    {
                        int id = Convert.ToInt32(msg["id"]);
                        TaskCompletionSource<Dictionary<string, object>> tcs;
                        if (_pending.TryRemove(id, out tcs))
                        {
                            if (msg.ContainsKey("error") && msg["error"] != null)
                                tcs.TrySetException(new Exception(Convert.ToString(msg["error"])));
                            else
                                tcs.TrySetResult(msg);
                        }
                    }
                }
            }
            catch { }
        }

        public void WriteRaw(object payload)
        {
            EnsureStarted();
            string line = _json.Serialize(payload);
            var writer = _utf8Writer;
            lock (_writeLock)
            {
                writer.WriteLine(line);
                writer.Flush();
            }
        }

        public Task<Dictionary<string, object>> CallAsync(Dictionary<string, object> payload, int timeoutMs = 600000)
        {
            EnsureStarted();
            int id = Interlocked.Increment(ref _seq);
            payload["id"] = id;
            var tcs = new TaskCompletionSource<Dictionary<string, object>>();
            _pending[id] = tcs;
            try
            {
                WriteRaw(payload);
            }
            catch (Exception ex)
            {
                TaskCompletionSource<Dictionary<string, object>> removed;
                _pending.TryRemove(id, out removed);
                tcs.TrySetException(ex);
            }
            return tcs.Task;
        }

        public void Dispose()
        {
            try
            {
                if (_proc != null && !_proc.HasExited) _proc.Kill();
            }
            catch { }
        }
    }

    internal sealed class LocalServer : IDisposable
    {
        private readonly string _clientRoot;
        private readonly Func<string, string> _resolveTrackPath;
        private TcpListener _listener;
        private volatile bool _running;

        private static readonly Dictionary<string, string> MimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" },
            { ".js", "text/javascript; charset=utf-8" },
            { ".css", "text/css; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" },
            { ".png", "image/png" },
            { ".svg", "image/svg+xml" },
            { ".ico", "image/x-icon" },
            { ".jpg", "image/jpeg" },
            { ".jpeg", "image/jpeg" },
            { ".webp", "image/webp" },
            { ".mp3", "audio/mpeg" },
            { ".wav", "audio/wav" },
            { ".flac", "audio/flac" },
            { ".m4a", "audio/mp4" },
            { ".aac", "audio/aac" },
            { ".ogg", "audio/ogg" },
        };

        public LocalServer(string clientRoot, int port, Func<string, string> resolveTrackPath)
        {
            _clientRoot = Path.GetFullPath(clientRoot);
            _resolveTrackPath = resolveTrackPath;
            _listener = new TcpListener(IPAddress.Loopback, port);
            _listener.Start();
            _running = true;
            ThreadPool.QueueUserWorkItem(_ => AcceptLoop());
        }

        private void AcceptLoop()
        {
            while (_running)
            {
                try
                {
                    var client = _listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(_ => HandleClient(client));
                }
                catch
                {
                    if (!_running) break;
                }
            }
        }

        private void HandleClient(TcpClient client)
        {
            using (client)
            using (var stream = client.GetStream())
            {
                try
                {
                    var reader = new StreamReader(stream, Encoding.ASCII, false, 4096, true);
                    string requestLine = reader.ReadLine();
                    if (string.IsNullOrEmpty(requestLine)) return;
                    string[] parts = requestLine.Split(' ');
                    if (parts.Length < 2) return;
                    string method = parts[0];
                    string rawUrl = parts[1];
                    string rangeHeader = null;
                    string line;
                    while (!string.IsNullOrEmpty(line = reader.ReadLine()))
                    {
                        if (line.StartsWith("Range:", StringComparison.OrdinalIgnoreCase))
                            rangeHeader = line.Substring(6).Trim();
                    }

                    string urlPath = Uri.UnescapeDataString(rawUrl.Split('?')[0]);
                    if (urlPath.StartsWith("/local-music/", StringComparison.OrdinalIgnoreCase))
                    {
                        string id = urlPath.Substring("/local-music/".Length);
                        string trackFile = _resolveTrackPath != null ? _resolveTrackPath(id) : null;
                        if (string.IsNullOrEmpty(trackFile) || !File.Exists(trackFile))
                        {
                            WriteStatus(stream, "404 Not Found", "text/plain", Encoding.UTF8.GetBytes("Not found"));
                            return;
                        }
                        ServeFileWithRange(stream, trackFile, method == "HEAD", rangeHeader);
                        return;
                    }

                    string rel = urlPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                    if (string.IsNullOrEmpty(rel)) rel = "index.html";
                    string full = Path.GetFullPath(Path.Combine(_clientRoot, rel));
                    if (!full.StartsWith(_clientRoot, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
                    {
                        full = Path.Combine(_clientRoot, "index.html");
                    }
                    byte[] body = File.ReadAllBytes(full);
                    string ext = Path.GetExtension(full);
                    string mime = MimeTypes.ContainsKey(ext) ? MimeTypes[ext] : "application/octet-stream";
                    WriteStatus(stream, "200 OK", mime, method == "HEAD" ? new byte[0] : body, body.Length);
                }
                catch { }
            }
        }

        private static void ServeFileWithRange(NetworkStream stream, string filePath, bool headOnly, string rangeHeader)
        {
            var fi = new FileInfo(filePath);
            long total = fi.Length;
            long start = 0, end = total - 1;
            bool isPartial = false;
            if (!string.IsNullOrEmpty(rangeHeader) && rangeHeader.StartsWith("bytes="))
            {
                string[] se = rangeHeader.Substring(6).Split('-');
                if (se.Length == 2)
                {
                    if (!string.IsNullOrEmpty(se[0])) long.TryParse(se[0], out start);
                    if (!string.IsNullOrEmpty(se[1])) long.TryParse(se[1], out end);
                    isPartial = true;
                }
            }
            if (start < 0 || start >= total) start = 0;
            if (end >= total || end < start) end = total - 1;
            long contentLen = end - start + 1;
            string ext = Path.GetExtension(filePath);
            string mime = MimeTypes.ContainsKey(ext) ? MimeTypes[ext] : "audio/mpeg";
            var sb = new StringBuilder();
            sb.Append(isPartial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
            sb.AppendFormat("Content-Type: {0}\r\n", mime);
            sb.AppendFormat("Content-Length: {0}\r\n", contentLen);
            sb.Append("Accept-Ranges: bytes\r\nCache-Control: no-store\r\nConnection: close\r\n");
            if (isPartial) sb.AppendFormat("Content-Range: bytes {0}-{1}/{2}\r\n", start, end, total);
            sb.Append("\r\n");
            byte[] headerBytes = Encoding.ASCII.GetBytes(sb.ToString());
            stream.Write(headerBytes, 0, headerBytes.Length);
            if (headOnly) return;
            using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                fs.Seek(start, SeekOrigin.Begin);
                byte[] buf = new byte[65536];
                long rem = contentLen;
                while (rem > 0)
                {
                    int read = fs.Read(buf, 0, (int)Math.Min(buf.Length, rem));
                    if (read <= 0) break;
                    stream.Write(buf, 0, read);
                    rem -= read;
                }
            }
        }

        private static void WriteStatus(NetworkStream stream, string status, string mime, byte[] body, int? overrideLen = null)
        {
            int len = overrideLen ?? body.Length;
            string headers = string.Format(
                "HTTP/1.1 {0}\r\nContent-Type: {1}\r\nContent-Length: {2}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
                status, mime, len);
            byte[] h = Encoding.ASCII.GetBytes(headers);
            stream.Write(h, 0, h.Length);
            if (body != null && body.Length > 0) stream.Write(body, 0, body.Length);
        }

        public void Dispose()
        {
            _running = false;
            try { _listener.Stop(); } catch { }
        }
    }

    internal sealed class LayeredPetOrbForm : Form
    {
        private readonly Dictionary<string, Image> _gifs = new Dictionary<string, Image>(StringComparer.OrdinalIgnoreCase);
        private Image _currentGif;
        private string _currentKey = "default";
        private string _bubbleText = "";
        private DateTime _bubbleUntil = DateTime.MinValue;
        private DateTime _poseUntil = DateTime.MinValue;
        private readonly System.Windows.Forms.Timer _animTimer;
        private readonly System.Windows.Forms.Timer _idleTimer;
        private readonly Random _rng = new Random();
        private double _breathePhase;
        private int _jumpStep = -1;
        private bool _dragging;
        private bool _moved;
        private Point _downScreen;
        private Point _lastScreen;
        private DateTime _lastClickTime = DateTime.MinValue;
        private bool _choiceMode;
        private bool _workingMode;
        private int _progressPercent = -1;
        private int _stripeOffset;
        private string _petTheme = "miao";
        private Rectangle _renameBtnRect = Rectangle.Empty;
        private Rectangle _watermarkBtnRect = Rectangle.Empty;
        private Rectangle _cancelBtnRect = Rectangle.Empty;
        public Action OnTogglePanel;
        public Action OnMoved;
        public Action<string[]> OnPathsDropped;
        public Action<string> OnDropChoice;

        public LayeredPetOrbForm(string miaoDir)
        {
            Text = "月薪喵";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            AllowDrop = true;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(230, 256);

            string[] keys = new string[] { "default", "angry", "comfort", "cry", "enjoy", "float", "play" };
            foreach (string k in keys)
            {
                string p = Path.Combine(miaoDir, k + ".gif");
                if (File.Exists(p))
                {
                    try
                    {
                        Image img = Image.FromFile(p);
                        if (ImageAnimator.CanAnimate(img)) ImageAnimator.Animate(img, OnGifFrameChanged);
                        _gifs[k] = img;
                    }
                    catch { }
                }
            }
            if (_gifs.ContainsKey("default")) _currentGif = _gifs["default"];

            _animTimer = new System.Windows.Forms.Timer { Interval = 33 };
            _animTimer.Tick += (s, e) => TickFrame();
            _animTimer.Start();

            _idleTimer = new System.Windows.Forms.Timer { Interval = 8500 };
            _idleTimer.Tick += (s, e) => TickIdleRandom();
            _idleTimer.Start();

            GreetByTime();
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x00080000 | 0x00000080; // WS_EX_LAYERED | WS_EX_TOOLWINDOW
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Win32.DisableBorderAndShadow(Handle);
            RenderLayered();
        }

        private void OnGifFrameChanged(object sender, EventArgs e) { }

        public void SetPetTheme(string theme)
        {
            _petTheme = string.Equals(theme, "dafeyu", StringComparison.OrdinalIgnoreCase) ? "dafeyu" : "miao";
            RenderLayered();
        }

        public void ShowMessage(string text, int durationMs = 2800)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            _choiceMode = false;
            _workingMode = false;
            _progressPercent = -1;
            _bubbleText = text;
            _bubbleUntil = DateTime.UtcNow.AddMilliseconds(durationMs);
        }

        public void ShowChoicePrompt(int count)
        {
            _choiceMode = true;
            _workingMode = false;
            _progressPercent = -1;
            _bubbleText = string.Format("收到 {0} 个文件，要做什么呢？", count);
            _bubbleUntil = DateTime.UtcNow.AddSeconds(30);
            if (_gifs.ContainsKey("comfort"))
            {
                _currentKey = "comfort";
                _currentGif = _gifs["comfort"];
                _poseUntil = DateTime.UtcNow.AddSeconds(30);
            }
            RenderLayered();
        }

        public void ShowProgress(string text, int percent)
        {
            _choiceMode = false;
            _workingMode = true;
            _progressPercent = Math.Max(4, Math.Min(100, percent));
            _bubbleText = text;
            _bubbleUntil = DateTime.UtcNow.AddSeconds(30);
            if (_gifs.ContainsKey("play"))
            {
                _currentKey = "play";
                _currentGif = _gifs["play"];
                _poseUntil = DateTime.MaxValue;
            }
            RenderLayered();
        }

        public void FinishWorking(string message)
        {
            _workingMode = false;
            _choiceMode = false;
            _progressPercent = -1;
            SwitchGif("default", string.IsNullOrWhiteSpace(message) ? "已经输出在原目录下啦 ✨" : message, 5200);
            RenderLayered();
        }

        public void SwitchGif(string key, string message, int durationMs = 5200)
        {
            if (!_gifs.ContainsKey(key)) key = "default";
            _currentKey = key;
            _currentGif = _gifs.ContainsKey(key) ? _gifs[key] : null;
            if (!string.IsNullOrEmpty(message)) ShowMessage(message, Math.Min(durationMs, 4800));
            _poseUntil = key == "default" ? DateTime.MaxValue : DateTime.UtcNow.AddMilliseconds(durationMs);
        }

        private void GreetByTime()
        {
            int h = DateTime.Now.Hour;
            if (h >= 5 && h < 11) SwitchGif("enjoy", "早上好呀！新的一天元气满满~ ☀️", 4500);
            else if (h >= 11 && h < 14) SwitchGif("comfort", "中午好！记得按时吃饭休息哦~ 🍱", 4500);
            else if (h >= 14 && h < 19) SwitchGif("play", "下午好！点我可展开剪映插件面板~ ✨", 4500);
            else if (h >= 19 && h < 23) SwitchGif("comfort", "晚上好！今天剪片辛苦啦~ 🥰", 4500);
            else SwitchGif("float", "夜深了，早点休息哦~ 💤", 5500);
        }

        private void TickIdleRandom()
        {
            if (!Visible || _currentKey != "default" || _choiceMode || _workingMode) return;
            if (_rng.NextDouble() < 0.62)
            {
                string[] pool = new string[] { "comfort", "enjoy", "play", "float", "cry" };
                string pick = pool[_rng.Next(pool.Length)];
                string msg = "";
                if (_rng.NextDouble() < 0.55)
                {
                    if (pick == "comfort") msg = "好舒服呀~ 蹭蹭~ 🥰";
                    else if (pick == "enjoy") msg = "今天也要开心导片哦 ✨";
                    else if (pick == "play") msg = "一起来玩手机呀~ 📱";
                    else if (pick == "float") msg = "我去休息一下啦~ 💤";
                    else msg = "拍拍小肚皮~ 陪陪我好不好~";
                }
                SwitchGif(pick, msg, 5400);
            }
        }

        private void TickFrame()
        {
            if (!Visible || IsDisposed || !IsHandleCreated) return;
            if (!_workingMode && !_choiceMode && _currentKey != "default" && DateTime.UtcNow >= _poseUntil)
            {
                _currentKey = "default";
                if (_gifs.ContainsKey("default")) _currentGif = _gifs["default"];
            }
            _breathePhase += 0.14;
            _stripeOffset = (_stripeOffset + 2) % 14;
            if (_jumpStep >= 0)
            {
                _jumpStep++;
                if (_jumpStep > 12) _jumpStep = -1;
            }
            RenderLayered();
        }

        private void DrawDafeyuMascot(Graphics g, int w, int h, int jumpOffset)
        {
            float bob = (float)(Math.Sin(_breathePhase * (_workingMode ? 2.4 : 1.0)) * 4.0) + jumpOffset;
            float wag = (float)(Math.Sin(_breathePhase * (_workingMode ? 3.6 : 1.4)) * 7.0);
            float cx = w / 2f - 6f;
            float cy = h - 86f + bob;

            // Tail fin
            PointF[] tailPts = new PointF[]
            {
                new PointF(cx + 40, cy - 2),
                new PointF(cx + 72, cy - 26 + wag),
                new PointF(cx + 64, cy + 2 + wag * 0.5f),
                new PointF(cx + 72, cy + 28 + wag),
                new PointF(cx + 40, cy + 8)
            };
            using (LinearGradientBrush tailBrush = new LinearGradientBrush(new RectangleF(cx + 36, cy - 30, 42, 64), Color.FromArgb(110, 212, 255), Color.FromArgb(40, 105, 184), 45f))
            {
                g.FillClosedCurve(tailBrush, tailPts);
            }

            // Dorsal fin
            PointF[] dorsalPts = new PointF[]
            {
                new PointF(cx - 10, cy - 36),
                new PointF(cx + 4, cy - 56),
                new PointF(cx + 24, cy - 34)
            };
            using (SolidBrush dorsalBrush = new SolidBrush(Color.FromArgb(92, 184, 240)))
            {
                g.FillClosedCurve(dorsalBrush, dorsalPts);
            }

            // Main chubby fish body
            RectangleF bodyRect = new RectangleF(cx - 52, cy - 42, 104, 84);
            using (LinearGradientBrush bodyBrush = new LinearGradientBrush(bodyRect, Color.FromArgb(139, 228, 255), Color.FromArgb(40, 105, 184), 65f))
            {
                g.FillEllipse(bodyBrush, bodyRect);
            }

            // Cream belly
            RectangleF bellyRect = new RectangleF(cx - 44, cy - 4, 84, 42);
            using (SolidBrush bellyBrush = new SolidBrush(Color.FromArgb(242, 250, 255)))
            {
                g.FillPie(bellyBrush, Rectangle.Round(bellyRect), 0, 180);
            }

            // Eye + pupil + highlight
            g.FillEllipse(Brushes.White, cx - 34, cy - 18, 18, 20);
            using (SolidBrush pupil = new SolidBrush(Color.FromArgb(23, 37, 84)))
            {
                g.FillEllipse(pupil, cx - 30, cy - 13, 11, 11);
            }
            g.FillEllipse(Brushes.White, cx - 28, cy - 11, 4.5f, 4.5f);

            // Rosy cheek + smile
            using (SolidBrush cheek = new SolidBrush(Color.FromArgb(165, 255, 141, 166)))
            {
                g.FillEllipse(cheek, cx - 40, cy + 3, 13, 7.5f);
            }
            using (Pen smilePen = new Pen(Color.FromArgb(30, 58, 138), 2.2f))
            {
                g.DrawArc(smilePen, cx - 48, cy - 4, 12, 8, 20, 140);
            }

            // Side pectoral fin
            PointF[] sideFin = new PointF[]
            {
                new PointF(cx - 4, cy + 8),
                new PointF(cx - 12, cy + 26 - wag * 0.4f),
                new PointF(cx + 10, cy + 16)
            };
            using (SolidBrush finBrush = new SolidBrush(Color.FromArgb(59, 142, 214)))
            {
                g.FillClosedCurve(finBrush, sideFin);
            }
        }

        private static void DrawMiniSwimmingFish(Graphics g, float x, float y)
        {
            // Cute mini blue/coral fish swimming right on the progress bar tip
            using (SolidBrush body = new SolidBrush(Color.FromArgb(255, 110, 64)))
            using (SolidBrush tail = new SolidBrush(Color.FromArgb(255, 145, 90)))
            {
                PointF[] tailPts = new PointF[]
                {
                    new PointF(x - 6, y),
                    new PointF(x - 12, y - 5),
                    new PointF(x - 12, y + 5)
                };
                g.FillPolygon(tail, tailPts);
                g.FillEllipse(body, x - 7, y - 5, 13, 10);
                g.FillEllipse(Brushes.White, x + 1.5f, y - 2.5f, 3.2f, 3.2f);
                g.FillEllipse(Brushes.Black, x + 2.5f, y - 1.8f, 1.8f, 1.8f);
            }
        }

        private void RenderLayered()
        {
            if (IsDisposed || !IsHandleCreated) return;
            int w = Width, h = Height;
            using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

                int jumpOffset = 0;
                if (_jumpStep >= 0 && _jumpStep <= 12)
                {
                    double t = _jumpStep / 12.0;
                    jumpOffset = -(int)Math.Round(Math.Sin(t * Math.PI) * 28.0);
                }

                if (_petTheme == "dafeyu")
                {
                    DrawDafeyuMascot(g, w, h, jumpOffset);
                }
                else if (_currentGif != null)
                {
                    try { ImageAnimator.UpdateFrames(_currentGif); } catch { }
                    int baseSize = 172;
                    int breatheDelta = _currentKey == "default" ? (int)Math.Round(Math.Sin(_breathePhase) * 2.5) : 0;
                    int drawSize = baseSize + breatheDelta;
                    int gx = (w - drawSize) / 2;
                    int gy = h - drawSize - 4 + jumpOffset;
                    g.DrawImage(_currentGif, new Rectangle(gx, gy, drawSize, drawSize));
                }

                _renameBtnRect = Rectangle.Empty;
                _watermarkBtnRect = Rectangle.Empty;
                _cancelBtnRect = Rectangle.Empty;

                if (!string.IsNullOrEmpty(_bubbleText) && DateTime.UtcNow < _bubbleUntil)
                {
                    using (Font font = new Font("Microsoft YaHei", 9.5f, FontStyle.Bold))
                    using (Font btnFont = new Font("Microsoft YaHei", 8.8f, FontStyle.Bold))
                    {
                        SizeF textSize = g.MeasureString(_bubbleText, font, w - 24);
                        int extraH = _choiceMode ? 28 : (_progressPercent >= 0 ? 14 : 0);
                        int bw = _choiceMode ? (w - 8) : Math.Min(w - 8, Math.Max(148, (int)Math.Ceiling(textSize.Width) + 24));
                        int textH = Math.Max(22, (int)Math.Ceiling(textSize.Height));
                        int bh = textH + 14 + extraH;
                        int bx = (w - bw) / 2;
                        int by = 4;
                        using (GraphicsPath path = CreateRoundRectPath(new Rectangle(bx, by, bw, bh), 14))
                        using (SolidBrush fill = new SolidBrush(Color.White))
                        using (Pen border = new Pen(Color.FromArgb(255, 182, 193), 2f))
                        using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                        {
                            g.FillPath(fill, path);
                            g.DrawPath(border, path);
                            g.DrawString(_bubbleText, font, Brushes.Black, new RectangleF(bx + 6, by + 5, bw - 12, textH + 2), sf);

                            if (_choiceMode)
                            {
                                int btnY = by + textH + 8;
                                int btnH = 22;
                                _renameBtnRect = new Rectangle(bx + 10, btnY, 78, btnH);
                                _watermarkBtnRect = new Rectangle(bx + 94, btnY, 84, btnH);
                                _cancelBtnRect = new Rectangle(bx + 184, btnY, 26, btnH);
                                using (SolidBrush btnFill = new SolidBrush(Color.FromArgb(255, 240, 244)))
                                using (Pen btnPen = new Pen(Color.FromArgb(255, 141, 166), 1.5f))
                                using (SolidBrush btnText = new SolidBrush(Color.FromArgb(184, 29, 78)))
                                {
                                    using (GraphicsPath p1 = CreateRoundRectPath(_renameBtnRect, 10))
                                    {
                                        g.FillPath(btnFill, p1);
                                        g.DrawPath(btnPen, p1);
                                        g.DrawString("改名", btnFont, btnText, _renameBtnRect, sf);
                                    }
                                    using (GraphicsPath p2 = CreateRoundRectPath(_watermarkBtnRect, 10))
                                    {
                                        g.FillPath(btnFill, p2);
                                        g.DrawPath(btnPen, p2);
                                        g.DrawString("加水印", btnFont, btnText, _watermarkBtnRect, sf);
                                    }
                                    using (GraphicsPath p3 = CreateRoundRectPath(_cancelBtnRect, 10))
                                    {
                                        g.FillPath(Brushes.WhiteSmoke, p3);
                                        g.DrawPath(Pens.LightGray, p3);
                                        g.DrawString("×", btnFont, Brushes.DimGray, _cancelBtnRect, sf);
                                    }
                                }
                            }
                            else if (_progressPercent >= 0)
                            {
                                Rectangle barBg = new Rectangle(bx + 12, by + textH + 8, bw - 24, 9);
                                int fillW = Math.Max(8, (int)Math.Round(barBg.Width * (_progressPercent / 100.0)));
                                Rectangle barFg = new Rectangle(barBg.X, barBg.Y, Math.Min(barBg.Width, fillW), barBg.Height);
                                using (SolidBrush bgBrush = new SolidBrush(Color.FromArgb(255, 228, 236)))
                                using (SolidBrush fgBrush = new SolidBrush(Color.FromArgb(255, 92, 138)))
                                using (Pen stripePen = new Pen(Color.FromArgb(115, 255, 255, 255), 3.2f))
                                {
                                    g.FillRectangle(bgBrush, barBg);
                                    g.FillRectangle(fgBrush, barFg);
                                    GraphicsState st = g.Save();
                                    g.SetClip(barFg);
                                    for (int sx = barBg.X - 18 + _stripeOffset; sx < barFg.Right + 14; sx += 12)
                                    {
                                        g.DrawLine(stripePen, sx, barBg.Bottom + 2, sx + 10, barBg.Top - 2);
                                    }
                                    g.Restore(st);
                                }
                                float fishX = Math.Max(barBg.X + 8, Math.Min(barBg.Right - 4, barFg.Right));
                                float fishY = barBg.Y + 4.5f + (float)(Math.Sin(_breathePhase * 2.2) * 1.6);
                                DrawMiniSwimmingFish(g, fishX, fishY);
                            }
                        }
                    }
                }

                IntPtr screenDc = Win32.GetDC(IntPtr.Zero);
                IntPtr memDc = Win32.CreateCompatibleDC(screenDc);
                IntPtr hBitmap = IntPtr.Zero;
                IntPtr oldBitmap = IntPtr.Zero;
                try
                {
                    hBitmap = bmp.GetHbitmap(Color.FromArgb(0));
                    oldBitmap = Win32.SelectObject(memDc, hBitmap);
                    Win32.POINT topPos = new Win32.POINT(Left, Top);
                    Win32.SIZE size = new Win32.SIZE(w, h);
                    Win32.POINT srcPos = new Win32.POINT(0, 0);
                    Win32.BLENDFUNCTION blend = new Win32.BLENDFUNCTION
                    {
                        BlendOp = Win32.AC_SRC_OVER,
                        BlendFlags = 0,
                        SourceConstantAlpha = 255,
                        AlphaFormat = Win32.AC_SRC_ALPHA
                    };
                    Win32.UpdateLayeredWindow(Handle, screenDc, ref topPos, ref size, memDc, ref srcPos, 0, ref blend, Win32.ULW_ALPHA);
                }
                finally
                {
                    if (oldBitmap != IntPtr.Zero) Win32.SelectObject(memDc, oldBitmap);
                    if (hBitmap != IntPtr.Zero) Win32.DeleteObject(hBitmap);
                    Win32.DeleteDC(memDc);
                    Win32.ReleaseDC(IntPtr.Zero, screenDc);
                }
            }
        }

        private static GraphicsPath CreateRoundRectPath(Rectangle r, int radius)
        {
            int d = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void OnDragEnter(DragEventArgs drgevent)
        {
            base.OnDragEnter(drgevent);
            if (drgevent.Data != null && drgevent.Data.GetDataPresent(DataFormats.FileDrop))
                drgevent.Effect = DragDropEffects.Copy;
            else
                drgevent.Effect = DragDropEffects.None;
        }

        protected override void OnDragDrop(DragEventArgs drgevent)
        {
            base.OnDragDrop(drgevent);
            try
            {
                if (drgevent.Data != null && drgevent.Data.GetDataPresent(DataFormats.FileDrop))
                {
                    string[] files = drgevent.Data.GetData(DataFormats.FileDrop) as string[];
                    if (files != null && files.Length > 0 && OnPathsDropped != null)
                    {
                        OnPathsDropped(files);
                    }
                }
            }
            catch { }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            if (_choiceMode && DateTime.UtcNow < _bubbleUntil)
            {
                Point pt = e.Location;
                if (_renameBtnRect.Contains(pt))
                {
                    _choiceMode = false;
                    _bubbleUntil = DateTime.MinValue;
                    RenderLayered();
                    if (OnDropChoice != null) OnDropChoice("rename");
                    return;
                }
                if (_watermarkBtnRect.Contains(pt))
                {
                    _choiceMode = false;
                    ShowProgress("努力加样片水印中 0%…", 4);
                    if (OnDropChoice != null) OnDropChoice("watermark");
                    return;
                }
                if (_cancelBtnRect.Contains(pt))
                {
                    _choiceMode = false;
                    _bubbleUntil = DateTime.MinValue;
                    RenderLayered();
                    if (OnDropChoice != null) OnDropChoice("cancel");
                    return;
                }
            }
            _dragging = true;
            _moved = false;
            _downScreen = _lastScreen = Control.MousePosition;
            Capture = true;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (!_dragging) return;
            Point cur = Control.MousePosition;
            if (Math.Abs(cur.X - _downScreen.X) + Math.Abs(cur.Y - _downScreen.Y) >= 5) _moved = true;
            if (_moved)
            {
                int dx = cur.X - _lastScreen.X;
                int dy = cur.Y - _lastScreen.Y;
                _lastScreen = cur;
                if (dx != 0 || dy != 0)
                {
                    Location = new Point(Left + dx, Top + dy);
                    var area = Screen.FromControl(this).WorkingArea;
                    if (Left <= area.Left + 4 || Top <= area.Top + 4 || Right >= area.Right - 4 || Bottom >= area.Bottom - 4)
                    {
                        SwitchGif("angry", "哎呀！撞疼我了！😣", 3000);
                    }
                    if (OnMoved != null) OnMoved();
                }
            }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button != MouseButtons.Left || !_dragging) return;
            _dragging = false;
            Capture = false;
            if (!_moved)
            {
                DateTime now = DateTime.UtcNow;
                if ((now - _lastClickTime).TotalMilliseconds <= 320)
                {
                    _lastClickTime = DateTime.MinValue;
                    _jumpStep = 0;
                    SwitchGif("enjoy", "双击好开心！✨", 4500);
                }
                else
                {
                    _lastClickTime = now;
                    if (OnTogglePanel != null) OnTogglePanel();
                }
            }
        }
    }

    internal sealed class NativePeriodKeeperEngine : IDisposable
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct MemoryRegion
        {
            public IntPtr BaseAddress, AllocationBase;
            public uint AllocationProtect;
            public ushort PartitionId;
            public UIntPtr RegionSize;
            public uint State, Protect, Type;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ModuleInfo
        {
            public IntPtr BaseOfDll;
            public uint SizeOfImage;
            public IntPtr EntryPoint;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr read);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr written);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool VirtualProtectEx(IntPtr process, IntPtr address, UIntPtr size, uint protection, out uint old);

        [DllImport("kernel32.dll")]
        private static extern UIntPtr VirtualQueryEx(IntPtr process, IntPtr address, out MemoryRegion region, UIntPtr length);

        [DllImport("kernel32.dll")]
        private static extern bool FlushInstructionCache(IntPtr process, IntPtr address, UIntPtr size);

        [DllImport("psapi.dll", SetLastError = true)]
        private static extern bool EnumProcessModules(IntPtr hProcess, [Out] IntPtr[] lphModule, uint cb, out uint lpcbNeeded);

        [DllImport("psapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetModuleBaseNameW(IntPtr hProcess, IntPtr hModule, StringBuilder lpBaseName, uint nSize);

        [DllImport("psapi.dll", SetLastError = true)]
        private static extern bool GetModuleInformation(IntPtr hProcess, IntPtr hModule, out ModuleInfo lpmodinfo, uint cb);

        [DllImport("user32.dll")]
        private static extern uint GetClipboardSequenceNumber();

        [DllImport("user32.dll")]
        private static extern bool OpenClipboard(IntPtr hWndNewOwner);

        [DllImport("user32.dll")]
        private static extern bool CloseClipboard();

        [DllImport("user32.dll")]
        private static extern bool EmptyClipboard();

        [DllImport("user32.dll")]
        private static extern bool IsClipboardFormatAvailable(uint format);

        [DllImport("user32.dll")]
        private static extern IntPtr GetClipboardData(uint uFormat);

        [DllImport("user32.dll")]
        private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GlobalLock(IntPtr hMem);

        [DllImport("kernel32.dll")]
        private static extern bool GlobalUnlock(IntPtr hMem);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GlobalFree(IntPtr hMem);

        private const uint CF_UNICODETEXT = 13;
        private const uint GMEM_MOVEABLE = 0x0002;

        // 1:1 from Kirota233/JianYing-Period-Keeper (VECreator.dll UTF-16 & UTF-8 punctuation tables)
        private static readonly byte[] OrigU16 = Encoding.Unicode.GetBytes("。！？!?；;，,、.\n\r");
        private static readonly byte[] PatchU16 = Encoding.Unicode.GetBytes("！！？!?；;！!、!\n\r");
        private static readonly byte[] OrigU8 = Encoding.UTF8.GetBytes("[。？！；“ .!?～]\0");
        private static readonly byte[] PatchU8 = Encoding.UTF8.GetBytes("[？！；“ !?～]\0\0\0\0\0");

        private readonly object _gate = new object();
        private volatile bool _disposed;
        private volatile bool _enabled;
        private string _mode = "compatible";
        private string _lastError = "";
        private uint _lastClipboardSeq;
        private int _patchedCount;
        private string _lastEngineState = "offline";
        private int _lastProcesses;
        private int _lastEditors;
        private readonly Thread _sentinelThread;
        private readonly Thread _monitorThread;

        public bool Enabled { get { return _enabled; } }

        public NativePeriodKeeperEngine()
        {
            EnsureVeCreatorIntegrity();
            _sentinelThread = new Thread(ClipboardSentinelLoop) { IsBackground = true, Name = "PeriodClipboardSentinel" };
            _sentinelThread.Start();
            _monitorThread = new Thread(MonitorJianyingLoop) { IsBackground = true, Name = "PeriodJianyingMonitor" };
            _monitorThread.Start();
        }

        private static void EnsureVeCreatorIntegrity()
        {
            try
            {
                string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string[] dirs = new string[]
                {
                    @"D:\JianyingPro",
                    @"C:\Program Files\JianyingPro",
                    Path.Combine(localApp, "JianyingPro", "Apps"),
                    Path.Combine(localApp, "JianyingPro")
                };
                foreach (string d in dirs)
                {
                    if (!Directory.Exists(d)) continue;
                    foreach (string bak in Directory.EnumerateFiles(d, "VECreator.dll.bak", SearchOption.AllDirectories))
                    {
                        string dll = bak.Substring(0, bak.Length - 4);
                        if (File.Exists(dll) && new FileInfo(dll).Length != new FileInfo(bak).Length)
                        {
                            try { File.Copy(bak, dll, true); } catch { }
                        }
                    }
                }
            }
            catch { }
        }

        public static bool NeedsProtection(string text)
        {
            if (string.IsNullOrEmpty(text)) return false;
            return text.IndexOf('.') >= 0 || text.IndexOf(',') >= 0 || text.IndexOf('。') >= 0 || text.IndexOf('，') >= 0;
        }

        public static bool NeedsRestoration(string text)
        {
            if (string.IsNullOrEmpty(text)) return false;
            return text.IndexOf('․') >= 0 || text.IndexOf('‚') >= 0 || text.IndexOf('﹒') >= 0 || text.IndexOf('﹐') >= 0 || text.IndexOf('\u2060') >= 0;
        }

        public static string ProtectText(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            text = text.Replace("\u2060", "");
            // Preserve 2+ consecutive dots (ellipses ...) untouched
            text = Regex.Replace(text, @"[ \t\u3000]*(\.{2,}|[.,。，])", m =>
            {
                string p = m.Groups[1].Value;
                if (p.Length >= 2 && p[0] == '.') return m.Value;
                if (p == ".") return "․";
                if (p == ",") return "‚";
                if (p == "。") return "﹒";
                if (p == "，") return "﹐";
                return m.Value;
            });
            return text;
        }

        public static string RestoreText(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            return text.Replace("\u2060", "")
                .Replace('․', '.')
                .Replace('‚', ',')
                .Replace('﹒', '。')
                .Replace('﹐', '，');
        }

        public static string WinGetClipboardText()
        {
            for (int i = 0; i < 5; i++)
            {
                if (OpenClipboard(IntPtr.Zero))
                {
                    try
                    {
                        if (!IsClipboardFormatAvailable(CF_UNICODETEXT)) return null;
                        IntPtr hData = GetClipboardData(CF_UNICODETEXT);
                        if (hData == IntPtr.Zero) return null;
                        IntPtr pData = GlobalLock(hData);
                        if (pData == IntPtr.Zero) return null;
                        try
                        {
                            return Marshal.PtrToStringUni(pData);
                        }
                        finally
                        {
                            GlobalUnlock(hData);
                        }
                    }
                    finally
                    {
                        CloseClipboard();
                    }
                }
                Thread.Sleep(20);
            }
            return null;
        }

        public static bool WinSetClipboardText(string text)
        {
            if (text == null) return false;
            byte[] bytes = Encoding.Unicode.GetBytes(text + "\0");
            for (int i = 0; i < 5; i++)
            {
                if (OpenClipboard(IntPtr.Zero))
                {
                    try
                    {
                        EmptyClipboard();
                        IntPtr hMem = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes.Length);
                        if (hMem == IntPtr.Zero) return false;
                        IntPtr pMem = GlobalLock(hMem);
                        if (pMem == IntPtr.Zero)
                        {
                            GlobalFree(hMem);
                            return false;
                        }
                        Marshal.Copy(bytes, 0, pMem, bytes.Length);
                        GlobalUnlock(hMem);
                        if (SetClipboardData(CF_UNICODETEXT, hMem) != IntPtr.Zero) return true;
                        GlobalFree(hMem);
                        return false;
                    }
                    finally
                    {
                        CloseClipboard();
                    }
                }
                Thread.Sleep(20);
            }
            return false;
        }

        private void ClipboardSentinelLoop()
        {
            while (!_disposed)
            {
                try
                {
                    if (_enabled && _mode == "compatible")
                    {
                        uint seq = GetClipboardSequenceNumber();
                        if (seq != _lastClipboardSeq)
                        {
                            _lastClipboardSeq = seq;
                            string text = WinGetClipboardText();
                            if (!string.IsNullOrEmpty(text) && text.Length <= 120000 && NeedsProtection(text))
                            {
                                string protectedText = ProtectText(text);
                                if (protectedText != text && WinSetClipboardText(protectedText))
                                {
                                    _lastClipboardSeq = GetClipboardSequenceNumber();
                                }
                            }
                        }
                    }
                }
                catch { }
                Thread.Sleep(100);
            }
        }

        private void MonitorJianyingLoop()
        {
            while (!_disposed)
            {
                try
                {
                    RefreshJianyingMemory(false);
                }
                catch { }
                Thread.Sleep(1200);
            }
        }

        private static int FindPattern(byte[] data, int dataLen, byte[] pattern)
        {
            int limit = dataLen - pattern.Length;
            for (int i = 0; i <= limit; i++)
            {
                if (data[i] != pattern[0]) continue;
                int j = 1;
                while (j < pattern.Length && data[i + j] == pattern[j]) j++;
                if (j == pattern.Length) return i;
            }
            return -1;
        }

        private static bool TryFindVeCreator(IntPtr hProcess, out long baseAddr, out int sizeOfImage)
        {
            baseAddr = 0;
            sizeOfImage = 0;
            IntPtr[] mods = new IntPtr[1024];
            uint needed;
            if (!EnumProcessModules(hProcess, mods, (uint)(mods.Length * IntPtr.Size), out needed)) return false;
            int count = (int)Math.Min((uint)mods.Length, needed / (uint)IntPtr.Size);
            var sb = new StringBuilder(260);
            for (int i = 0; i < count; i++)
            {
                sb.Length = 0;
                if (GetModuleBaseNameW(hProcess, mods[i], sb, (uint)sb.Capacity) == 0) continue;
                if (!string.Equals(sb.ToString(), "VECreator.dll", StringComparison.OrdinalIgnoreCase)) continue;
                ModuleInfo info;
                if (GetModuleInformation(hProcess, mods[i], out info, (uint)Marshal.SizeOf(typeof(ModuleInfo))))
                {
                    baseAddr = info.BaseOfDll.ToInt64();
                    sizeOfImage = (int)info.SizeOfImage;
                    return baseAddr != 0 && sizeOfImage > 0;
                }
            }
            return false;
        }

        private static int ScanAndPatchProcess(int pid, bool applyPatch, bool onlyCheck, out bool hasEditor, out bool accessDenied)
        {
            hasEditor = false;
            accessDenied = false;
            IntPtr h = OpenProcess(0x1F0FFFu, false, pid);
            if (h == IntPtr.Zero) h = OpenProcess(onlyCheck ? 0x0410u : 0x0438u, false, pid);
            if (h == IntPtr.Zero)
            {
                accessDenied = true;
                return 0;
            }
            int activeOrModified = 0;
            try
            {
                long baseAddr;
                int sizeOfImage;
                if (!TryFindVeCreator(h, out baseAddr, out sizeOfImage)) return 0;
                hasEditor = true;

                long curr = baseAddr;
                long end = baseAddr + sizeOfImage;
                int mbiSize = Marshal.SizeOf(typeof(MemoryRegion));

                byte[] u16Src = applyPatch ? OrigU16 : PatchU16;
                byte[] u16Dst = applyPatch ? PatchU16 : OrigU16;
                byte[] u8Src = applyPatch ? OrigU8 : PatchU8;
                byte[] u8Dst = applyPatch ? PatchU8 : OrigU8;

                while (curr < end)
                {
                    MemoryRegion mbi;
                    if (VirtualQueryEx(h, new IntPtr(curr), out mbi, (UIntPtr)mbiSize).ToUInt64() == 0) break;
                    long regSize = (long)mbi.RegionSize.ToUInt64();
                    if (regSize <= 0) break;
                    long next = Math.Min(end, mbi.BaseAddress.ToInt64() + regSize);

                    if (mbi.State == 0x1000 && (mbi.Protect & 0xEE) != 0 && (mbi.Protect & 0x100) == 0)
                    {
                        for (long chunk = curr; chunk < next; chunk += 1024 * 1024)
                        {
                            int len = (int)Math.Min(1024 * 1024 + 64, next - chunk);
                            byte[] buf = new byte[len];
                            UIntPtr readBytes;
                            if (!ReadProcessMemory(h, new IntPtr(chunk), buf, (UIntPtr)len, out readBytes)) continue;
                            int actualLen = (int)readBytes.ToUInt64();
                            if (actualLen <= 0) continue;

                            // Check if already patched
                            if (applyPatch)
                            {
                                if (FindPattern(buf, actualLen, PatchU16) >= 0) activeOrModified++;
                                if (FindPattern(buf, actualLen, PatchU8) >= 0) activeOrModified++;
                            }

                            if (!onlyCheck)
                            {
                                int p1 = FindPattern(buf, actualLen, u16Src);
                                if (p1 >= 0 && p1 < 1024 * 1024)
                                {
                                    long va = chunk + p1;
                                    uint oldProt;
                                    if (VirtualProtectEx(h, new IntPtr(va), (UIntPtr)u16Dst.Length, 0x40, out oldProt))
                                    {
                                        UIntPtr written;
                                        WriteProcessMemory(h, new IntPtr(va), u16Dst, (UIntPtr)u16Dst.Length, out written);
                                        uint dummy;
                                        VirtualProtectEx(h, new IntPtr(va), (UIntPtr)u16Dst.Length, oldProt, out dummy);
                                        FlushInstructionCache(h, new IntPtr(va), (UIntPtr)u16Dst.Length);
                                        activeOrModified++;
                                    }
                                }

                                int p2 = FindPattern(buf, actualLen, u8Src);
                                if (p2 >= 0 && p2 < 1024 * 1024)
                                {
                                    long va2 = chunk + p2;
                                    uint oldProt2;
                                    if (VirtualProtectEx(h, new IntPtr(va2), (UIntPtr)u8Dst.Length, 0x40, out oldProt2))
                                    {
                                        UIntPtr written2;
                                        WriteProcessMemory(h, new IntPtr(va2), u8Dst, (UIntPtr)u8Dst.Length, out written2);
                                        uint dummy2;
                                        VirtualProtectEx(h, new IntPtr(va2), (UIntPtr)u8Dst.Length, oldProt2, out dummy2);
                                        FlushInstructionCache(h, new IntPtr(va2), (UIntPtr)u8Dst.Length);
                                        activeOrModified++;
                                    }
                                }
                            }
                        }
                    }
                    curr = next;
                }
            }
            finally
            {
                CloseHandle(h);
            }
            return activeOrModified;
        }

        public Dictionary<string, object> RefreshJianyingMemory(bool forceApplyOrRestore)
        {
            lock (_gate)
            {
                int processes = 0, editors = 0, denied = 0, patched = 0;
                Process[] procs = Process.GetProcessesByName("JianyingPro");
                foreach (Process p in procs)
                {
                    using (p)
                    {
                        processes++;
                        bool hasEd, accDen;
                        bool onlyCheck = !forceApplyOrRestore && !_enabled;
                        int cnt = ScanAndPatchProcess(p.Id, _enabled, onlyCheck, out hasEd, out accDen);
                        if (hasEd) editors++;
                        if (accDen) denied++;
                        patched += cnt;
                    }
                }
                _lastProcesses = processes;
                _lastEditors = editors;
                _patchedCount = _enabled ? patched : 0;
                _lastEngineState = processes == 0
                    ? "offline"
                    : editors == 0
                        ? (denied > 0 ? "denied" : "standby")
                        : denied > 0
                            ? "denied"
                            : _enabled && patched > 0
                                ? "active"
                                : "ready";
                return GetStatus();
            }
        }

        public Dictionary<string, object> SetEnabled(bool enabled, string mode)
        {
            lock (_gate)
            {
                _enabled = enabled;
                if (!string.IsNullOrEmpty(mode) && (mode == "standard" || mode == "compatible"))
                {
                    _mode = mode;
                }
                else
                {
                    _mode = "compatible";
                }
                _lastError = "";

                RefreshJianyingMemory(true);

                try
                {
                    string clip = WinGetClipboardText();
                    if (!string.IsNullOrEmpty(clip) && clip.Length <= 120000)
                    {
                        if (_enabled && _mode == "compatible" && NeedsProtection(clip))
                        {
                            string prot = ProtectText(clip);
                            if (prot != clip && WinSetClipboardText(prot))
                            {
                                _lastClipboardSeq = GetClipboardSequenceNumber();
                            }
                        }
                        else if ((!_enabled || _mode != "compatible") && NeedsRestoration(clip))
                        {
                            string rest = RestoreText(clip);
                            if (rest != clip && WinSetClipboardText(rest))
                            {
                                _lastClipboardSeq = GetClipboardSequenceNumber();
                            }
                        }
                    }
                }
                catch { }

                return GetStatus();
            }
        }

        public Dictionary<string, object> CopySubtitle(string rawText)
        {
            string clean = (rawText ?? "").Replace("\0", "").Replace("\r\n", "\n").Replace("\r", "\n");
            // Normalize ellipses .. -> ...
            clean = Regex.Replace(clean, @"[‥…]", "...");
            clean = Regex.Replace(clean, @"\.(?:[ \t\u3000]*\.)+", "...");
            string output = (_enabled && _mode == "compatible") ? ProtectText(clean) : clean;
            string winText = output.Replace("\n", "\r\n");
            bool ok = WinSetClipboardText(winText);
            if (ok) _lastClipboardSeq = GetClipboardSequenceNumber();
            int lines = 0;
            foreach (string line in clean.Split('\n'))
            {
                if (!string.IsNullOrWhiteSpace(line)) lines++;
            }
            var st = GetStatus();
            st["ok"] = ok;
            st["copyVerified"] = ok;
            st["copiedCharacters"] = clean.Length;
            st["copiedLines"] = lines;
            return st;
        }

        public Dictionary<string, object> GetStatus()
        {
            return new Dictionary<string, object>
            {
                { "enabled", _enabled },
                { "mode", _mode },
                { "punctuationMode", _mode },
                { "clipboardProtected", _enabled && _mode == "compatible" },
                { "clipboardError", "" },
                { "engine", _lastEngineState },
                { "processes", _lastProcesses },
                { "editors", _lastEditors },
                { "patchedSites", _patchedCount },
                { "compatibleSites", _patchedCount },
                { "ready", true },
                { "error", _lastError }
            };
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            try { if (_enabled) SetEnabled(false, _mode); } catch { }
        }
    }


    internal sealed class ResizablePanelForm : Form
    {
        private const int WM_NCHITTEST = 0x84;
        private const int HTCLIENT = 1;
        private const int HTLEFT = 10;
        private const int HTRIGHT = 11;
        private const int HTTOP = 12;
        private const int HTTOPLEFT = 13;
        private const int HTTOPRIGHT = 14;
        private const int HTBOTTOM = 15;
        private const int HTBOTTOMLEFT = 16;
        private const int HTBOTTOMRIGHT = 17;
        private const int BORDER_GRIP = 8;

        public ResizablePanelForm()
        {
            this.DoubleBuffered = true;
            this.SetStyle(ControlStyles.ResizeRedraw, true);
            this.MinimumSize = new Size(320, 300);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_NCHITTEST)
            {
                base.WndProc(ref m);
                int result = m.Result.ToInt32();
                if (result == HTCLIENT)
                {
                    Point pt = PointToClient(new Point(m.LParam.ToInt32() & 0xFFFF, m.LParam.ToInt32() >> 16));
                    bool left = pt.X <= BORDER_GRIP;
                    bool right = pt.X >= ClientSize.Width - BORDER_GRIP;
                    bool top = pt.Y <= BORDER_GRIP;
                    bool bottom = pt.Y >= ClientSize.Height - BORDER_GRIP;

                    if (top && left) { m.Result = (IntPtr)HTTOPLEFT; return; }
                    if (top && right) { m.Result = (IntPtr)HTTOPRIGHT; return; }
                    if (bottom && left) { m.Result = (IntPtr)HTBOTTOMLEFT; return; }
                    if (bottom && right) { m.Result = (IntPtr)HTBOTTOMRIGHT; return; }
                    if (left) { m.Result = (IntPtr)HTLEFT; return; }
                    if (right) { m.Result = (IntPtr)HTRIGHT; return; }
                    if (top) { m.Result = (IntPtr)HTTOP; return; }
                    if (bottom) { m.Result = (IntPtr)HTBOTTOM; return; }
                }
                return;
            }
            base.WndProc(ref m);
        }
    }

    internal static class ModernFolderPicker
    {
        [ComImport]
        [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
        public class FileOpenDialogRCW { }

        [ComImport]
        [Guid("d57c7288-d4ad-4768-be02-9d969532d960")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IFileOpenDialog
        {
            [PreserveSig] int Show([In] IntPtr parent);
            void SetFileTypes([In] uint cFileTypes, [In] IntPtr rgFilterSpec);
            void SetFileTypeIndex([In] uint iFileType);
            void GetFileTypeIndex(out uint piFileType);
            void Advise([In, MarshalAs(UnmanagedType.Interface)] IntPtr pfde, out uint pdwCookie);
            void Unadvise([In] uint dwCookie);
            void SetOptions([In] uint fos);
            void GetOptions(out uint pfos);
            void SetDefaultFolder([In, MarshalAs(UnmanagedType.Interface)] IShellItem psi);
            void SetFolder([In, MarshalAs(UnmanagedType.Interface)] IShellItem psi);
            void GetFolder([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
            void GetCurrentSelection([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
            void SetFileName([In, MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
            void SetTitle([In, MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
            void SetOkButtonLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszText);
            void SetFileNameLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
            void GetResult([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
            void AddPlace([In, MarshalAs(UnmanagedType.Interface)] IShellItem psi, int fdap);
            void SetDefaultExtension([In, MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
            void Close([MarshalAs(UnmanagedType.Error)] int hr);
            void SetClientGuid([In] ref Guid guid);
            void ClearClientData();
            void SetFilter([MarshalAs(UnmanagedType.Interface)] IntPtr pFilter);
            void GetResults([MarshalAs(UnmanagedType.Interface)] out IntPtr ppenum);
            void GetSelectedItems([MarshalAs(UnmanagedType.Interface)] out IntPtr ppsai);
        }

        [ComImport]
        [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IShellItem
        {
            void BindToHandler([In, MarshalAs(UnmanagedType.Interface)] IntPtr pbc, [In] ref Guid bhid, [In] ref Guid riid, out IntPtr ppv);
            void GetParent([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
            void GetDisplayName([In] uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
            void GetAttributes([In] uint sfgaoMask, out uint psfgaoAttribs);
            void Compare([In, MarshalAs(UnmanagedType.Interface)] IShellItem psi, [In] uint hint, out int piOrder);
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern int SHCreateItemFromParsingName(
            [In, MarshalAs(UnmanagedType.LPWStr)] string pszPath,
            [In] IntPtr pbc,
            [In] ref Guid riid,
            [Out] out IntPtr ppv);

        private const uint FOS_PICKFOLDERS = 0x00000020;
        private const uint FOS_FORCEFILESYSTEM = 0x00000040;
        private const uint SIGDN_FILESYSPATH = 0x80058000;

        public static string ShowDialog(IntPtr parentHwnd, string title, string initialFolder = null)
        {
            try
            {
                var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
                dialog.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
                if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
                if (!string.IsNullOrEmpty(initialFolder) && Directory.Exists(initialFolder))
                {
                    try
                    {
                        IntPtr nativeShellItem;
                        Guid riid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
                        if (SHCreateItemFromParsingName(initialFolder, IntPtr.Zero, ref riid, out nativeShellItem) == 0 && nativeShellItem != IntPtr.Zero)
                        {
                            var shellItem = (IShellItem)Marshal.GetObjectForIUnknown(nativeShellItem);
                            dialog.SetFolder(shellItem);
                            Marshal.Release(nativeShellItem);
                        }
                    }
                    catch { }
                }
                int hr = dialog.Show(parentHwnd);
                if (hr == 0)
                {
                    IShellItem item;
                    dialog.GetResult(out item);
                    if (item != null)
                    {
                        string path;
                        item.GetDisplayName(SIGDN_FILESYSPATH, out path);
                        return path ?? "";
                    }
                }
                return "";
            }
            catch
            {
                using (var dlg = new FolderBrowserDialog { Description = title, ShowNewFolderButton = true })
                {
                    IWin32Window owner = parentHwnd != IntPtr.Zero ? new Win32WindowWrapper(parentHwnd) : null;
                    if (dlg.ShowDialog(owner) == DialogResult.OK) return dlg.SelectedPath;
                }
                return "";
            }
        }

        private class Win32WindowWrapper : IWin32Window
        {
            private readonly IntPtr _hwnd;
            public Win32WindowWrapper(IntPtr hwnd) { _hwnd = hwnd; }
            public IntPtr Handle { get { return _hwnd; } }
        }
    }

    internal sealed class StudioAppContext : ApplicationContext
    {
        public const string CurrentVersion = "1.7.4";
        public const int AppPort = 37651;
        private readonly string _baseDir;
        private readonly string _userDataDir;
        private readonly string _clientDir;
        private readonly string _bridgeScript;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        private LocalServer _server;
        private Form _mainForm;
        private WebView2 _mainWebView;
        private WebView2 _aiWebView;
        private string _activeAiProvider = "deepseek";
        private LayeredPetOrbForm _orbForm;
        private Form _panelForm;
        private WebView2 _panelWebView;
        private NotifyIcon _tray;
        private System.Windows.Forms.Timer _companionTimer;

        private bool _companionVisible = false;
        private bool _panelOpen = false;
        private bool _autoDock = false;
        private bool _panelHiddenForScan = false;
        private int _jyStatusPolling = 0;
        private bool _quitting = false;
        private string _activeCompanionStage = "export";
        private string _forceStageToken = "";
        private string _petTheme = "miao";
        private readonly List<string> _pendingDropFiles = new List<string>();
        private readonly List<string> _renameFiles = new List<string>();
        private string _orbNotice = "";
        private string _orbNoticeToken = "";
        private object _cachedProviders = null;
        private readonly Dictionary<string, Task<CoreWebView2Environment>> _webViewEnvs = new Dictionary<string, Task<CoreWebView2Environment>>(StringComparer.OrdinalIgnoreCase);

        private JsonRpcChild _jianyingRpc;
        private JsonRpcChild _watermarkRpc;
        private Dictionary<string, object> _lastJianyingState = new Dictionary<string, object>
        {
            { "ready", false }, { "busy", false }, { "status", "引擎预热中…" }, { "queue", new object[0] }, { "logs", new object[0] }
        };

        // Watermark state
        private Dictionary<string, object> _wmSettings = new Dictionary<string, object>
        {
            { "mode", "image" },
            { "watermarkText", "内部样片 · 严禁外传" },
            { "watermarkImage", "builtin" },
            { "position", "fullscreen" },
            { "opacity", 1.0 },
            { "scale", 0.28 },
            { "size", "original" },
            { "crf", 23 },
            { "audioMode", "auto" },
            { "outputDir", "" },
            { "suffix", "样片" }
        };
        private readonly List<Dictionary<string, object>> _wmJobs = new List<Dictionary<string, object>>();
        private bool _wmRunning = false;
        private bool _wmCancel = false;

        // PeriodKeeper native engine (1:1 JianYing-Period-Keeper VECreator.dll patcher + Clipboard Sentinel)
        private NativePeriodKeeperEngine _periodEngine;

        // Music Library state
        private List<string> _musicRoots = new List<string>();
        private readonly ConcurrentDictionary<string, string> _musicIdToPath = new ConcurrentDictionary<string, string>();
        private readonly ConcurrentDictionary<string, string> _dragTokens = new ConcurrentDictionary<string, string>();
        private Dictionary<string, object> _musicCatalog = new Dictionary<string, object>
        {
            { "directories", new object[0] }, { "tracks", new object[0] }, { "scannedAt", 0 }, { "revision", "" }, { "warning", "" }
        };

        // Updater state
        private Dictionary<string, object> _updaterState = new Dictionary<string, object>
        {
            { "status", "idle" },
            { "currentVersion", CurrentVersion },
            { "latestVersion", CurrentVersion },
            { "hasUpdate", false },
            { "progress", 0 },
            { "releaseUrl", "https://github.com/Kirota233/XM-Editing-Studio/releases" },
            { "downloadUrl", "" },
            { "assetName", "" },
            { "expectedSha256", "" },
            { "installerPath", "" },
            { "error", "" }
        };

        public StudioAppContext()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            _baseDir = AppDomain.CurrentDomain.BaseDirectory;
            _userDataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "XM剪辑台");
            Directory.CreateDirectory(_userDataDir);

            _clientDir = ResolveExistingDir(
                Path.Combine(_baseDir, "resources", "client"),
                Path.Combine(_baseDir, "dist", "client"),
                Path.Combine(_baseDir, "..", "..", "dist", "client")
            );
            string bridgeFile = Path.Combine(_clientDir, "assets", "webview2-bridge.js");
            _bridgeScript = File.Exists(bridgeFile) ? File.ReadAllText(bridgeFile, Encoding.UTF8) : "";

            LoadSavedSettings();
            try
            {
                string pCacheFile = Path.Combine(_userDataDir, "providers-cache.json");
                if (File.Exists(pCacheFile))
                {
                    _cachedProviders = _json.DeserializeObject(File.ReadAllText(pCacheFile, Encoding.UTF8));
                }
            }
            catch { }
            _server = new LocalServer(_clientDir, AppPort, id =>
            {
                string p;
                return _musicIdToPath.TryGetValue(id, out p) ? p : null;
            });

            string jyExe = ResolveExistingFile(
                Path.Combine(_baseDir, "resources", "jianying", "JianYingEngine.exe"),
                Path.Combine(_baseDir, "build", "jianying", "JianYingEngine.exe"),
                Path.Combine(_baseDir, "..", "..", "build", "jianying", "JianYingEngine.exe")
            );
            if (!string.IsNullOrEmpty(jyExe))
            {
                string jyDataDir = Path.Combine(_userDataDir, "jianying-ai");
                Directory.CreateDirectory(jyDataDir);
                _jianyingRpc = new JsonRpcChild(jyExe, "--data-dir \"" + jyDataDir + "\"");
                _jianyingRpc.OnEvent = ev =>
                {
                    string evName = ev.ContainsKey("event") ? Convert.ToString(ev["event"]) : "";
                    if (evName == "state" && ev.ContainsKey("state") && ev["state"] is Dictionary<string, object>)
                    {
                        _lastJianyingState = (Dictionary<string, object>)ev["state"];
                        SendEventToMain("bos:jianying-state", _lastJianyingState);
                        if (!IsJianyingBusy()) RestorePanelAfterScan();
                        BroadcastCompanionState();
                    }
                    else if (evName == "scan-capture" && ev.ContainsKey("id"))
                    {
                        // 截图前临时隐藏悬浮面板，避免挡住剪映首页的草稿缩略图。
                        object capId = ev["id"];
                        Task.Run(async () =>
                        {
                            HidePanelForScan(true);
                            await Task.Delay(300);
                            var unused = _jianyingRpc.CallAsync(new Dictionary<string, object>
                            {
                                { "action", "scan_capture_ready" },
                                { "args", new Dictionary<string, object> { { "id", capId }, { "error", "" } } }
                            });
                        });
                    }
                    else if (evName == "scan-captured")
                    {
                        RestorePanelAfterScan();
                    }
                    else if (evName == "extract-progress")
                    {
                        int cur = ev.ContainsKey("current") ? Convert.ToInt32(ev["current"]) : 0;
                        int tot = ev.ContainsKey("total") ? Convert.ToInt32(ev["total"]) : 0;
                        int pct = ev.ContainsKey("percent") ? Convert.ToInt32(ev["percent"]) : 0;
                        RunOnUi(() =>
                        {
                            if (_orbForm != null && !_orbForm.IsDisposed)
                            {
                                if (pct < 100) _orbForm.ShowProgress(string.Format("提取字幕 {0}% ({1}/{2})…", pct, cur, tot), Math.Max(4, pct));
                                else _orbForm.FinishWorking(string.Format("字幕提取完成 ✨ (共 {0} 个草稿)", tot));
                            }
                        }, false);
                        SendEventToMain("bos:jianying-extract-progress", ev);
                        BroadcastCompanionState();
                    }
                    else if (evName == "scan-progress")
                    {
                        string stage = ev.ContainsKey("stage") ? Convert.ToString(ev["stage"]) : "";
                        if (stage == "complete" || stage == "error" || stage == "cancelled")
                        {
                            RestorePanelAfterScan();
                        }
                        var unused = RefreshJianyingStatusAsync();
                    }
                    else if (evName == "recording-progress")
                    {
                        string msg = ev.ContainsKey("message") ? Convert.ToString(ev["message"]) : "";
                        string stage = ev.ContainsKey("stage") ? Convert.ToString(ev["stage"]) : "";
                        if (!string.IsNullOrEmpty(msg))
                        {
                            RunOnUi(() =>
                            {
                                if (_orbForm != null && !_orbForm.IsDisposed)
                                {
                                    _orbForm.SwitchGif(stage == "complete" ? "enjoy" : "play", msg, stage == "complete" ? 5000 : 12000);
                                }
                            }, false);
                        }
                        var unused = RefreshJianyingStatusAsync();
                    }
                    else if (evName == "export-progress")
                    {
                        var unused = RefreshJianyingStatusAsync();
                    }
                    else if (evName == "recording-capture" && ev.ContainsKey("id") && ev.ContainsKey("token"))
                    {
                        var unused = _jianyingRpc.CallAsync(new Dictionary<string, object>
                        {
                            { "action", "recording_capture_ready" },
                            { "args", new Dictionary<string, object> { { "id", ev["id"] }, { "token", ev["token"] }, { "error", "" } } }
                        });
                    }
                    else if (evName == "ai" || evName == "ai_request")
                    {
                        SendEventToMain("bos:jianying-ai-request", ev);
                    }
                };
            }

            string wmExe = ResolveExistingFile(
                Path.Combine(_baseDir, "resources", "watermark", "WatermarkEngine.exe"),
                Path.Combine(_baseDir, "build", "watermark", "WatermarkEngine.exe"),
                Path.Combine(_baseDir, "..", "..", "build", "watermark", "WatermarkEngine.exe")
            );
            if (!string.IsNullOrEmpty(wmExe))
            {
                _watermarkRpc = new JsonRpcChild(wmExe);
                _watermarkRpc.OnEvent = ev =>
                {
                    if (ev.ContainsKey("event") && Convert.ToString(ev["event"]) == "progress")
                    {
                        int pct = ev.ContainsKey("progress") ? Convert.ToInt32(ev["progress"]) : 0;
                        foreach (var job in _wmJobs)
                        {
                            if (Convert.ToString(job["status"]) == "processing")
                            {
                                job["progress"] = Math.Max(1, Math.Min(99, pct));
                            }
                        }
                        BroadcastWatermarkState();
                    }
                };
            }

            _periodEngine = new NativePeriodKeeperEngine();
            InitMainForm();
            InitSystemTray();

            _companionTimer = new System.Windows.Forms.Timer { Interval = 1400 };
            _companionTimer.Tick += (s, e) => TickCompanion();
            _companionTimer.Start();
        }

        private static string ResolveExistingDir(params string[] candidates)
        {
            foreach (var c in candidates)
            {
                try { string full = Path.GetFullPath(c); if (Directory.Exists(full)) return full; } catch { }
            }
            return AppDomain.CurrentDomain.BaseDirectory;
        }

        private static string ResolveExistingFile(params string[] candidates)
        {
            foreach (var c in candidates)
            {
                try { string full = Path.GetFullPath(c); if (File.Exists(full)) return full; } catch { }
            }
            return null;
        }

        private Icon LoadAppIcon()
        {
            string iconPath = ResolveExistingFile(
                Path.Combine(_baseDir, "app-icon.ico"),
                Path.Combine(_baseDir, "resources", "app-icon.ico"),
                Path.Combine(_baseDir, "build", "app-icon.ico")
            );
            if (!string.IsNullOrEmpty(iconPath))
            {
                try { return new Icon(iconPath); } catch { }
            }
            return SystemIcons.Application;
        }

        private void InitMainForm()
        {
            _mainForm = new Form
            {
                Text = "XM剪辑台",
                Width = 1440,
                Height = 940,
                MinimumSize = new Size(920, 680),
                StartPosition = FormStartPosition.CenterScreen,
                FormBorderStyle = FormBorderStyle.None,
                BackColor = Color.FromArgb(9, 11, 12),
                Icon = LoadAppIcon(),
            };
            Win32.EnableRoundedAndDark(_mainForm.Handle, false);

            _mainWebView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(9, 11, 12),
            };
            _mainForm.Controls.Add(_mainWebView);

            _mainForm.FormClosing += (s, e) =>
            {
                if (!_quitting && _companionVisible && _tray != null)
                {
                    e.Cancel = true;
                    _mainForm.Hide();
                    return;
                }
                DisposeAll();
            };

            _mainForm.Shown += async (s, e) =>
            {
                await InitWebViewAsync(_mainWebView, "main", string.Format("http://127.0.0.1:{0}/", AppPort), true);
                await ShowCompanionAsync(false);
                var unusedInit = Task.Run(async () =>
                {
                    await Task.Delay(1200);
                    if (_jianyingRpc != null)
                    {
                        try
                        {
                            var initRes = await _jianyingRpc.CallAsync(new Dictionary<string, object> { { "action", "status" }, { "args", new Dictionary<string, object>() } });
                            if (initRes != null && initRes.ContainsKey("state") && initRes["state"] is Dictionary<string, object>)
                                _lastJianyingState = (Dictionary<string, object>)initRes["state"];
                        }
                        catch { }
                    }
                    await CheckUpdaterAsync();
                });
            };

            _mainForm.Show();
        }

        private async Task InitWebViewAsync(WebView2 wv, string profileSubdir, string url, bool injectBridge)
        {
            string envDir = Path.Combine(_userDataDir, "webview2", profileSubdir);
            Directory.CreateDirectory(envDir);
            Task<CoreWebView2Environment> envTask;
            if (!_webViewEnvs.TryGetValue(profileSubdir, out envTask) || envTask.IsFaulted || envTask.IsCanceled)
            {
                envTask = CoreWebView2Environment.CreateAsync(null, envDir);
                _webViewEnvs[profileSubdir] = envTask;
            }
            var env = await envTask;
            await wv.EnsureCoreWebView2Async(env);
            wv.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            wv.CoreWebView2.Settings.AreDevToolsEnabled = false;
            wv.CoreWebView2.Settings.IsStatusBarEnabled = false;

            if (injectBridge && !string.IsNullOrEmpty(_bridgeScript))
            {
                await wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(_bridgeScript);
                wv.CoreWebView2.WebMessageReceived += (s, e) =>
                {
                    string raw = e.TryGetWebMessageAsString();
                    if (!string.IsNullOrEmpty(raw))
                    {
                        var unusedMsg = HandleBridgeMessageAsync(wv, raw);
                    }
                };
                wv.CoreWebView2.NewWindowRequested += (s, e) =>
                {
                    e.Handled = true;
                    if (e.Uri != null && (e.Uri.StartsWith("https://") || e.Uri.StartsWith("http://")))
                    {
                        try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { }
                    }
                };
            }
            wv.CoreWebView2.Navigate(url);
        }

        private void SendEventToMain(string eventName, object data)
        {
            SendEventToWebView(_mainWebView, eventName, data);
        }

        private void SendEventToWebView(WebView2 wv, string eventName, object data)
        {
            if (wv == null || wv.IsDisposed) return;
            if (wv.InvokeRequired)
            {
                wv.BeginInvoke(new Action(() => SendEventToWebView(wv, eventName, data)));
                return;
            }
            try
            {
                if (wv.CoreWebView2 != null)
                {
                    string msg = _json.Serialize(new Dictionary<string, object> { { "event", eventName }, { "data", data } });
                    wv.CoreWebView2.PostWebMessageAsJson(msg);
                }
            }
            catch { }
        }

        private async Task HandleBridgeMessageAsync(WebView2 senderWv, string rawJson)
        {
            Dictionary<string, object> req;
            try { req = _json.Deserialize<Dictionary<string, object>>(rawJson); } catch { return; }
            if (req == null) return;
            object id = req.ContainsKey("id") ? req["id"] : null;
            string cmd = req.ContainsKey("cmd") ? Convert.ToString(req["cmd"]) : "";
            var payload = req.ContainsKey("payload") && req["payload"] is Dictionary<string, object>
                ? (Dictionary<string, object>)req["payload"]
                : new Dictionary<string, object>();

            try
            {
                object result = await DispatchCommandAsync(cmd, payload);
                ReplyBridge(senderWv, id, result, null);
            }
            catch (Exception ex)
            {
                ReplyBridge(senderWv, id, null, ex.Message ?? "操作失败");
            }
        }

        private void ReplyBridge(WebView2 wv, object id, object result, string error)
        {
            if (id == null || wv == null || wv.IsDisposed) return;
            if (wv.InvokeRequired)
            {
                wv.BeginInvoke(new Action(() => ReplyBridge(wv, id, result, error)));
                return;
            }
            try
            {
                var resp = new Dictionary<string, object> { { "id", id } };
                if (!string.IsNullOrEmpty(error)) resp["error"] = error;
                else resp["result"] = result;
                wv.CoreWebView2.PostWebMessageAsJson(_json.Serialize(resp));
            }
            catch { }
        }

        private async Task<object> DispatchCommandAsync(string cmd, Dictionary<string, object> payload)
        {
            switch (cmd)
            {
                case "window-control":
                    return HandleWindowControl(payload);
                case "http-fetch":
                    return await Task.Run(() => PerformHttpFetch(payload));
                case "watermark:get-state":
                    return GetWatermarkSnapshot();
                case "watermark:choose-videos":
                    return ChooseWatermarkVideos();
                case "watermark:add-videos":
                    if (payload.ContainsKey("paths") && payload["paths"] is ArrayList)
                    {
                        var list = new List<string>();
                        foreach (var item in (ArrayList)payload["paths"]) list.Add(Convert.ToString(item));
                        AddWatermarkVideos(list);
                    }
                    return GetWatermarkSnapshot();
                case "watermark:choose-image":
                    return ChooseWatermarkImage();
                case "watermark:choose-output-dir":
                    return ChooseWatermarkOutputDir();
                case "watermark:update-settings":
                    UpdateWatermarkSettings(payload);
                    return GetWatermarkSnapshot();
                case "watermark:remove-job":
                    RemoveWatermarkJob(payload.ContainsKey("jobId") ? Convert.ToString(payload["jobId"]) : "");
                    return GetWatermarkSnapshot();
                case "watermark:clear-jobs":
                    ClearWatermarkJobs(payload.ContainsKey("mode") ? Convert.ToString(payload["mode"]) : "completed");
                    return GetWatermarkSnapshot();
                case "watermark:retry-failed":
                    RetryWatermarkJobs();
                    return GetWatermarkSnapshot();
                case "watermark:start":
                    StartWatermarkBatch();
                    return GetWatermarkSnapshot();
                case "watermark:cancel":
                    await CancelWatermarkBatchAsync();
                    return GetWatermarkSnapshot();
                case "watermark:open-path":
                    OpenExplorerPath(payload.ContainsKey("targetPath") ? Convert.ToString(payload["targetPath"]) : "");
                    return new Dictionary<string, object> { { "ok", true } };

                case "jianying-action":
                    return await HandleJianyingActionAsync(payload);
                case "jianying-ai-reply":
                    if (_jianyingRpc != null)
                    {
                        var unused = _jianyingRpc.CallAsync(new Dictionary<string, object>
                        {
                            { "action", "ai_result" },
                            { "args", payload }
                        });
                    }
                    return new Dictionary<string, object> { { "ok", true } };
                case "jianying-files":
                    return ChooseJianyingFiles();

                case "period-status":
                case "period-probe":
                    return await Task.Run(() => _periodEngine.RefreshJianyingMemory(false));
                case "period-enabled":
                    {
                        bool en = payload.ContainsKey("enabled") && Convert.ToBoolean(payload["enabled"]);
                        string mode = payload.ContainsKey("mode") ? Convert.ToString(payload["mode"]) : "compatible";
                        var st = await Task.Run(() => _periodEngine.SetEnabled(en, mode));
                        BroadcastCompanionState();
                        return st;
                    }
                case "period-copy":
                    {
                        string text = payload.ContainsKey("text") ? Convert.ToString(payload["text"]) : "";
                        return await Task.Run(() => _periodEngine.CopySubtitle(text));
                    }
                case "copy-plain":
                    SetClipboardTextSafe(payload.ContainsKey("text") ? Convert.ToString(payload["text"]) : "");
                    return new Dictionary<string, object> { { "ok", true }, { "copyVerified", true } };

                case "choose-directory":
                    return ChooseFolderDialog("选择文件夹");
                case "music-library-list":
                    return _musicCatalog;
                case "music-library-refresh":
                    return await Task.Run(() => ScanMusicLibrary());
                case "music-library-connect":
                    {
                        string dir = ChooseFolderDialog("连接本地音乐文件夹");
                        if (!string.IsNullOrEmpty(dir) && !_musicRoots.Contains(dir))
                        {
                            _musicRoots.Add(dir);
                            SaveSettings();
                        }
                        return await Task.Run(() => ScanMusicLibrary());
                    }
                case "music-library-disconnect":
                    {
                        string id = payload.ContainsKey("id") ? Convert.ToString(payload["id"]) : "";
                        _musicRoots.RemoveAll(r => Sha256Hex(r.ToLowerInvariant()) == id);
                        SaveSettings();
                        return await Task.Run(() => ScanMusicLibrary());
                    }
                case "prepare-music-drag":
                    {
                        string trackId = payload.ContainsKey("trackId") ? Convert.ToString(payload["trackId"]) : "";
                        string path;
                        if (!string.IsNullOrEmpty(trackId) && _musicIdToPath.TryGetValue(trackId, out path) && File.Exists(path))
                        {
                            string token = Guid.NewGuid().ToString("N");
                            _dragTokens[token] = path;
                            return new Dictionary<string, object> { { "token", token }, { "fileName", Path.GetFileName(path) } };
                        }
                        throw new Exception("未找到可拖动的本地音频文件");
                    }
                case "start-music-drag":
                    {
                        string token = payload.ContainsKey("token") ? Convert.ToString(payload["token"]) : "";
                        string file;
                        if (_dragTokens.TryGetValue(token, out file) && File.Exists(file))
                        {
                            _mainForm.BeginInvoke(new Action(() =>
                            {
                                var data = new DataObject(DataFormats.FileDrop, new string[] { file });
                                _mainForm.DoDragDrop(data, DragDropEffects.Copy);
                            }));
                        }
                        return new Dictionary<string, object> { { "ok", true } };
                    }
                case "download-audio":
                    return await Task.Run(() => DownloadAudioFile(payload));
                case "export-script-materials":
                    return await Task.Run(() => ExportScriptMaterials(payload));
                case "write-cache":
                    {
                        string dir = Convert.ToString(payload["directory"]);
                        string fn = payload.ContainsKey("fileName") ? Convert.ToString(payload["fileName"]) : "music-cache.json";
                        Directory.CreateDirectory(dir);
                        string full = Path.Combine(dir, fn);
                        File.WriteAllText(full, _json.Serialize(payload.ContainsKey("data") ? payload["data"] : null), Encoding.UTF8);
                        return new Dictionary<string, object> { { "ok", true }, { "path", full } };
                    }
                case "read-cache":
                    {
                        string dir = Convert.ToString(payload["directory"]);
                        string fn = payload.ContainsKey("fileName") ? Convert.ToString(payload["fileName"]) : "music-cache.json";
                        string full = Path.Combine(dir, fn);
                        if (!File.Exists(full)) return new Dictionary<string, object> { { "ok", true }, { "data", null } };
                        return new Dictionary<string, object> { { "ok", true }, { "data", _json.DeserializeObject(File.ReadAllText(full, Encoding.UTF8)) } };
                    }

                case "web-ai-layout":
                    return await HandleWebAiLayoutAsync(payload);
                case "web-ai-action":
                    return await HandleWebAiActionAsync(payload);
                case "web-analysis-status":
                    return null;

                case "companion-action":
                    return await HandleCompanionActionAsync(
                        payload.ContainsKey("action") ? Convert.ToString(payload["action"]) : "",
                        payload.ContainsKey("value") ? payload["value"] : null
                    );

                case "updater-status":
                    return _updaterState;
                case "updater-action":
                    {
                        string act = payload.ContainsKey("action") ? Convert.ToString(payload["action"]) : "check";
                        if (act == "check") return await CheckUpdaterAsync();
                        if (act == "download") return await DownloadUpdateAsync();
                        if (act == "install") return InstallUpdate();
                        return _updaterState;
                    }
                case "titlebar-theme":
                case "quick-launch":
                    if (payload.ContainsKey("action") && Convert.ToString(payload["action"]) == "launch")
                    {
                        LaunchJianyingExecutable();
                    }
                    return new Dictionary<string, object> { { "ok", true }, { "folders", new object[0] }, { "installs", new object[0] } };
                default:
                    return new Dictionary<string, object> { { "ok", true } };
            }
        }

        private object HandleWindowControl(Dictionary<string, object> payload)
        {
            string action = payload.ContainsKey("action") ? Convert.ToString(payload["action"]) : "";
            _mainForm.BeginInvoke(new Action(() =>
            {
                if (action == "min") _mainForm.WindowState = FormWindowState.Minimized;
                else if (action == "max")
                    _mainForm.WindowState = _mainForm.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                else if (action == "close") _mainForm.Close();
                else if (action == "drag")
                {
                    Win32.ReleaseCapture();
                    Win32.SendMessage(_mainForm.Handle, Win32.WM_NCLBUTTONDOWN, (IntPtr)Win32.HTCAPTION, IntPtr.Zero);
                }
            }));
            return new Dictionary<string, object> { { "ok", true } };
        }

        private Dictionary<string, object> PerformHttpFetch(Dictionary<string, object> payload)
        {
            string url = Convert.ToString(payload["url"]);
            string method = payload.ContainsKey("method") ? Convert.ToString(payload["method"]) : "GET";
            string body = payload.ContainsKey("body") ? Convert.ToString(payload["body"]) : "";
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = method;
            req.Timeout = 135000;
            req.UserAgent = "XM-Editing-Studio/" + CurrentVersion;

            if (payload.ContainsKey("headers") && payload["headers"] is Dictionary<string, object>)
            {
                var headers = (Dictionary<string, object>)payload["headers"];
                foreach (var kv in headers)
                {
                    string k = kv.Key;
                    string v = Convert.ToString(kv.Value);
                    if (string.Equals(k, "Content-Type", StringComparison.OrdinalIgnoreCase)) req.ContentType = v;
                    else if (string.Equals(k, "Accept", StringComparison.OrdinalIgnoreCase)) req.Accept = v;
                    else if (string.Equals(k, "User-Agent", StringComparison.OrdinalIgnoreCase)) req.UserAgent = v;
                    else req.Headers[k] = v;
                }
            }

            if (!string.IsNullOrEmpty(body) && (method == "POST" || method == "PUT" || method == "PATCH"))
            {
                byte[] bytes = Encoding.UTF8.GetBytes(body);
                req.ContentLength = bytes.Length;
                using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            }

            HttpWebResponse resp = null;
            try
            {
                resp = (HttpWebResponse)req.GetResponse();
            }
            catch (WebException wex)
            {
                resp = wex.Response as HttpWebResponse;
                if (resp == null) throw new Exception("网络连接失败: " + wex.Message);
            }

            using (resp)
            {
                int status = (int)resp.StatusCode;
                string text = "";
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    text = sr.ReadToEnd();
                }
                var respHeaders = new Dictionary<string, string>();
                foreach (string hk in resp.Headers.AllKeys)
                {
                    if (hk != null) respHeaders[hk.ToLowerInvariant()] = resp.Headers[hk];
                }
                return new Dictionary<string, object>
                {
                    { "ok", status >= 200 && status < 300 },
                    { "status", status },
                    { "body", text },
                    { "headers", respHeaders }
                };
            }
        }

        // ======================== Watermark Host ========================
        private Dictionary<string, object> GetWatermarkSnapshot()
        {
            int total = _wmJobs.Count;
            int done = 0, err = 0, sumPct = 0;
            string activeId = "", activeName = "";
            foreach (var j in _wmJobs)
            {
                string st = Convert.ToString(j["status"]);
                if (st == "done") { done++; sumPct += 100; }
                else if (st == "error") err++;
                else if (st == "processing")
                {
                    activeId = Convert.ToString(j["id"]);
                    activeName = Convert.ToString(j["fileName"]);
                    sumPct += Convert.ToInt32(j["progress"]);
                }
            }
            return new Dictionary<string, object>
            {
                { "engine", "windows-media-foundation-hw" },
                { "running", _wmRunning },
                { "totalCount", total },
                { "completedCount", done },
                { "errorCount", err },
                { "overallProgress", total == 0 ? 0 : (int)Math.Round((double)sumPct / total) },
                { "activeJobId", activeId },
                { "activeFileName", activeName },
                { "settings", new Dictionary<string, object>(_wmSettings) },
                { "jobs", _wmJobs.ToArray() }
            };
        }

        private void BroadcastWatermarkState()
        {
            var snap = GetWatermarkSnapshot();
            SendEventToMain("bos:watermark-state", snap);
            if (_wmRunning && _orbForm != null && !_orbForm.IsDisposed)
            {
                int pct = Convert.ToInt32(snap["overallProgress"]);
                int done = Convert.ToInt32(snap["completedCount"]);
                int total = Convert.ToInt32(snap["totalCount"]);
                _mainForm.BeginInvoke(new Action(() =>
                {
                    if (_orbForm != null && !_orbForm.IsDisposed)
                        _orbForm.ShowProgress(string.Format("正在加水印 {0}% ({1}/{2})…", pct, done, total), Math.Max(2, pct));
                }));
            }
            BroadcastCompanionState();
        }

        private string ResolveWmOutputPath(string inputPath, bool sameDirectory = false)
        {
            string dir = sameDirectory ? "" : Convert.ToString(_wmSettings["outputDir"]).Trim();
            if (string.IsNullOrEmpty(dir)) dir = Path.GetDirectoryName(inputPath);
            string suffix = Convert.ToString(_wmSettings["suffix"]).Trim();
            if (string.IsNullOrEmpty(suffix)) suffix = "样片";
            return Path.Combine(dir, Path.GetFileNameWithoutExtension(inputPath) + suffix + ".mp4");
        }

        private void AddWatermarkVideos(IEnumerable<string> paths, bool sameDirectory = false)
        {
            foreach (string raw in paths)
            {
                if (string.IsNullOrWhiteSpace(raw) || !File.Exists(raw)) continue;
                string full = Path.GetFullPath(raw);
                bool exists = false;
                foreach (var j in _wmJobs)
                {
                    string st = Convert.ToString(j["status"]);
                    if (string.Equals(Convert.ToString(j["inputPath"]), full, StringComparison.OrdinalIgnoreCase) &&
                        (st == "pending" || st == "processing"))
                    {
                        exists = true; break;
                    }
                }
                if (exists) continue;
                var fi = new FileInfo(full);
                _wmJobs.Add(new Dictionary<string, object>
                {
                    { "id", "wm-" + Guid.NewGuid().ToString("N").Substring(0, 8) },
                    { "inputPath", full },
                    { "fileName", fi.Name },
                    { "sizeBytes", fi.Length },
                    { "sameDirectory", sameDirectory },
                    { "outputPath", ResolveWmOutputPath(full, sameDirectory) },
                    { "status", "pending" },
                    { "progress", 0 },
                    { "elapsedMs", 0 },
                    { "error", "" }
                });
            }
            BroadcastWatermarkState();
        }

        private Dictionary<string, object> ChooseWatermarkVideos()
        {
            string[] files = null;
            _mainForm.Invoke(new Action(() =>
            {
                using (var dlg = new OpenFileDialog
                {
                    Title = "选择要添加水印的视频文件（支持多选）",
                    Multiselect = true,
                    Filter = "视频文件|*.mp4;*.mov;*.mkv;*.avi;*.m4v;*.webm"
                })
                {
                    if (dlg.ShowDialog(_mainForm) == DialogResult.OK) files = dlg.FileNames;
                }
            }));
            if (files != null && files.Length > 0) AddWatermarkVideos(files);
            return GetWatermarkSnapshot();
        }

        private Dictionary<string, object> ChooseWatermarkImage()
        {
            string file = null;
            _mainForm.Invoke(new Action(() =>
            {
                using (var dlg = new OpenFileDialog
                {
                    Title = "选择水印透明 PNG / 图标文件",
                    Filter = "图片文件|*.png;*.webp;*.bmp;*.jpg;*.jpeg"
                })
                {
                    if (dlg.ShowDialog(_mainForm) == DialogResult.OK) file = dlg.FileName;
                }
            }));
            if (!string.IsNullOrEmpty(file))
            {
                _wmSettings["mode"] = "image";
                _wmSettings["watermarkImage"] = file;
                SaveSettings();
                BroadcastWatermarkState();
            }
            return GetWatermarkSnapshot();
        }

        private Dictionary<string, object> ChooseWatermarkOutputDir()
        {
            string dir = ChooseFolderDialog("选择水印视频输出文件夹");
            if (dir != null)
            {
                _wmSettings["outputDir"] = dir;
                foreach (var j in _wmJobs)
                    if (Convert.ToString(j["status"]) == "pending") j["outputPath"] = ResolveWmOutputPath(Convert.ToString(j["inputPath"]));
                SaveSettings();
                BroadcastWatermarkState();
            }
            return GetWatermarkSnapshot();
        }

        private void UpdateWatermarkSettings(Dictionary<string, object> patch)
        {
            foreach (var kv in patch) _wmSettings[kv.Key] = kv.Value;
            foreach (var j in _wmJobs)
                if (Convert.ToString(j["status"]) == "pending") j["outputPath"] = ResolveWmOutputPath(Convert.ToString(j["inputPath"]));
            SaveSettings();
            BroadcastWatermarkState();
        }

        private void RemoveWatermarkJob(string jobId)
        {
            _wmJobs.RemoveAll(j => Convert.ToString(j["id"]) == jobId && Convert.ToString(j["status"]) != "processing");
            BroadcastWatermarkState();
        }

        private void ClearWatermarkJobs(string mode)
        {
            if (mode == "all") _wmJobs.RemoveAll(j => Convert.ToString(j["status"]) != "processing");
            else _wmJobs.RemoveAll(j => Convert.ToString(j["status"]) == "done" || Convert.ToString(j["status"]) == "cancelled");
            BroadcastWatermarkState();
        }

        private void RetryWatermarkJobs()
        {
            foreach (var j in _wmJobs)
            {
                string st = Convert.ToString(j["status"]);
                if (st == "error" || st == "cancelled")
                {
                    j["status"] = "pending";
                    j["progress"] = 0;
                    j["error"] = "";
                }
            }
            BroadcastWatermarkState();
        }

        private void StartWatermarkBatch(bool forceSameDir = false)
        {
            if (_wmRunning || _watermarkRpc == null) return;
            _wmRunning = true;
            _wmCancel = false;
            BroadcastWatermarkState();

            Task.Run(async () =>
            {
                int doneCount = 0;
                try
                {
                    foreach (var job in _wmJobs.ToArray())
                    {
                        if (_wmCancel)
                        {
                            if (Convert.ToString(job["status"]) == "pending") job["status"] = "cancelled";
                            continue;
                        }
                        string st = Convert.ToString(job["status"]);
                        if (st != "pending" && st != "error" && st != "cancelled") continue;

                        bool sameDir = forceSameDir || (job.ContainsKey("sameDirectory") && Convert.ToBoolean(job["sameDirectory"]));
                        job["sameDirectory"] = sameDir;
                        job["status"] = "processing";
                        job["progress"] = 1;
                        job["error"] = "";
                        job["outputPath"] = ResolveWmOutputPath(Convert.ToString(job["inputPath"]), sameDir);
                        BroadcastWatermarkState();

                        try
                        {
                            var res = await _watermarkRpc.CallAsync(new Dictionary<string, object>
                            {
                                { "action", "process" },
                                { "input", job["inputPath"] },
                                { "output", job["outputPath"] },
                                { "watermarkImage", "builtin" },
                                { "watermarkText", "" },
                                { "position", "fullscreen" },
                                { "opacity", 1.0 },
                                { "scale", 1.0 },
                                { "size", "original" },
                                { "crf", 23 }
                            });
                            job["status"] = "done";
                            job["progress"] = 100;
                            job["elapsedMs"] = res.ContainsKey("elapsedMs") ? res["elapsedMs"] : 0;
                            doneCount++;
                        }
                        catch (Exception ex)
                        {
                            job["status"] = _wmCancel ? "cancelled" : "error";
                            job["error"] = ex.Message;
                        }
                        BroadcastWatermarkState();
                    }
                }
                finally
                {
                    bool wasCancel = _wmCancel;
                    _wmRunning = false;
                    if (!wasCancel && doneCount > 0)
                    {
                        _orbNotice = "已经输出在原目录下啦 ✨";
                        _orbNoticeToken = DateTime.UtcNow.Ticks.ToString();
                        if (_mainForm != null && !_mainForm.IsDisposed)
                        {
                            _mainForm.BeginInvoke(new Action(() =>
                            {
                                if (_orbForm != null && !_orbForm.IsDisposed)
                                    _orbForm.FinishWorking("已经输出在原目录下啦 ✨");
                            }));
                        }
                    }
                    BroadcastWatermarkState();
                }
            });
        }

        private async Task CancelWatermarkBatchAsync()
        {
            _wmCancel = true;
            if (_watermarkRpc != null)
            {
                try { await _watermarkRpc.CallAsync(new Dictionary<string, object> { { "action", "cancel" } }, 3000); } catch { }
            }
            BroadcastWatermarkState();
        }

        // ======================== Jianying Automation ========================
        private async Task<object> HandleJianyingActionAsync(Dictionary<string, object> payload)
        {
            if (_jianyingRpc == null) return _lastJianyingState;
            string action = payload.ContainsKey("action") ? Convert.ToString(payload["action"]) : "status";
            var args = payload.ContainsKey("args") && payload["args"] is Dictionary<string, object>
                ? new Dictionary<string, object>((Dictionary<string, object>)payload["args"])
                : new Dictionary<string, object>();
            var req = new Dictionary<string, object>
            {
                { "action", action },
                { "args", args }
            };
            var res = await _jianyingRpc.CallAsync(req);
            if (res != null && res.ContainsKey("state") && res["state"] is Dictionary<string, object>)
            {
                _lastJianyingState = (Dictionary<string, object>)res["state"];
            }
            else if (res != null)
            {
                _lastJianyingState = res;
            }
            SendEventToMain("bos:jianying-state", _lastJianyingState);
            BroadcastCompanionState();
            return _lastJianyingState;
        }

        private string[] ChooseJianyingFiles()
        {
            string[] files = null;
            _mainForm.Invoke(new Action(() =>
            {
                using (var dlg = new OpenFileDialog
                {
                    Title = "选择要改名的文件",
                    Multiselect = true,
                    Filter = "视频、音频和字幕|*.mp4;*.mov;*.avi;*.mkv;*.mp3;*.wav;*.srt;*.ass"
                })
                {
                    if (dlg.ShowDialog(_mainForm) == DialogResult.OK) files = dlg.FileNames;
                }
            }));
            return files;
        }

        // ======================== Domestic Web AI (DeepSeek / Doubao) ========================
        private async Task<object> HandleWebAiLayoutAsync(Dictionary<string, object> payload)
        {
            bool visible = payload.ContainsKey("visible") && Convert.ToBoolean(payload["visible"]);
            string provider = payload.ContainsKey("provider") ? Convert.ToString(payload["provider"]) : "deepseek";
            _activeAiProvider = provider;
            string targetUrl = provider == "doubao" ? "https://www.doubao.com/chat/" : "https://chat.deepseek.com/";

            var tcs = new TaskCompletionSource<object>();
            _mainForm.BeginInvoke(new Action(async () =>
            {
                try
                {
                    if (!visible)
                    {
                        if (_aiWebView != null) BrowserInput.Hide(_aiWebView, _mainWebView);
                        tcs.TrySetResult(null);
                        return;
                    }
                    var b = payload.ContainsKey("bounds") && payload["bounds"] is Dictionary<string, object>
                        ? (Dictionary<string, object>)payload["bounds"]
                        : null;
                    if (b == null) { tcs.TrySetResult(null); return; }
                    int x = Convert.ToInt32(b["x"]);
                    int y = Convert.ToInt32(b["y"]);
                    int w = Convert.ToInt32(b["width"]);
                    int h = Convert.ToInt32(b["height"]);
                    if (w < 100 || h < 80)
                    {
                        if (_aiWebView != null) BrowserInput.Hide(_aiWebView, _mainWebView);
                        tcs.TrySetResult(null);
                        return;
                    }

                    if (_aiWebView == null)
                    {
                        _aiWebView = new WebView2
                        {
                            DefaultBackgroundColor = Color.FromArgb(14, 18, 20),
                            Visible = false
                        };
                        _mainForm.Controls.Add(_aiWebView);
                        _aiWebView.BringToFront();
                        await InitWebViewAsync(_aiWebView, "web-ai", targetUrl, false);
                    }
                    else if (_aiWebView.CoreWebView2 != null)
                    {
                        string curUrl = _aiWebView.CoreWebView2.Source ?? "";
                        string expectedDomain = provider == "doubao" ? "doubao.com" : "deepseek.com";
                        if (curUrl.IndexOf(expectedDomain, StringComparison.OrdinalIgnoreCase) < 0)
                        {
                            _aiWebView.CoreWebView2.Navigate(targetUrl);
                        }
                    }

                    _aiWebView.SetBounds(x, y, w, h);
                    IntPtr rgn = Win32.CreateRoundRectRgn(0, 0, w + 1, h + 1, 28, 28);
                    _aiWebView.Region = Region.FromHrgn(rgn);
                    Win32.DeleteObject(rgn);
                    _aiWebView.Visible = true;
                    _aiWebView.BringToFront();

                    tcs.TrySetResult(new Dictionary<string, object>
                    {
                        { "provider", provider },
                        { "loading", false },
                        { "error", "" },
                        { "official", true },
                        { "url", _aiWebView.CoreWebView2 != null ? _aiWebView.CoreWebView2.Source : targetUrl }
                    });
                }
                catch (Exception ex)
                {
                    tcs.TrySetException(ex);
                }
            }));
            return await tcs.Task;
        }

        private Task<object> HandleWebAiActionAsync(Dictionary<string, object> payload)
        {
            string id = payload.ContainsKey("id") ? Convert.ToString(payload["id"]) : _activeAiProvider;
            string action = payload.ContainsKey("action") ? Convert.ToString(payload["action"]) : "status";
            string targetUrl = id == "doubao" ? "https://www.doubao.com/chat/" : "https://chat.deepseek.com/";

            if (action == "external")
            {
                try { Process.Start(new ProcessStartInfo(targetUrl) { UseShellExecute = true }); } catch { }
                return Task.FromResult<object>(new Dictionary<string, object> { { "provider", id }, { "external", true } });
            }
            if (_aiWebView != null && !_aiWebView.IsDisposed)
            {
                _mainForm.BeginInvoke(new Action(() =>
                {
                    if (_aiWebView.CoreWebView2 == null) return;
                    if (action == "reload") _aiWebView.CoreWebView2.Reload();
                    else if (action == "home") _aiWebView.CoreWebView2.Navigate(targetUrl);
                }));
            }
            return Task.FromResult<object>(new Dictionary<string, object>
            {
                { "provider", id },
                { "loading", false },
                { "error", "" },
                { "official", true },
                { "url", targetUrl }
            });
        }

        // ======================== Companion Dock 「悬浮窗 · 月薪喵」 ========================
        private static readonly HashSet<string> SupportedDropExts = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm", ".mp3", ".wav", ".srt", ".ass"
        };
        private static readonly HashSet<string> VideoOnlyExts = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm"
        };

        private static List<string> ExpandDroppedPaths(IEnumerable<string> rawPaths)
        {
            var result = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (rawPaths == null) return result;
            foreach (string raw in rawPaths)
            {
                if (string.IsNullOrWhiteSpace(raw)) continue;
                try
                {
                    string full = Path.GetFullPath(raw.Trim());
                    if (Directory.Exists(full))
                    {
                        foreach (string f in Directory.EnumerateFiles(full, "*.*", SearchOption.AllDirectories))
                        {
                            string ext = Path.GetExtension(f);
                            if (SupportedDropExts.Contains(ext) && !f.EndsWith("样片.mp4", StringComparison.OrdinalIgnoreCase) && seen.Add(f))
                            {
                                result.Add(f);
                            }
                        }
                    }
                    else if (File.Exists(full))
                    {
                        string ext = Path.GetExtension(full);
                        if (SupportedDropExts.Contains(ext) && !full.EndsWith("样片.mp4", StringComparison.OrdinalIgnoreCase) && seen.Add(full))
                        {
                            result.Add(full);
                        }
                    }
                }
                catch { }
            }
            return result;
        }

        private void NotifyOrbMessage(string msg)
        {
            _orbNotice = msg ?? "";
            _orbNoticeToken = DateTime.UtcNow.Ticks.ToString();
            if (_mainForm != null && !_mainForm.IsDisposed)
            {
                _mainForm.BeginInvoke(new Action(() =>
                {
                    if (_orbForm != null && !_orbForm.IsDisposed)
                    {
                        _orbForm.SwitchGif("enjoy", _orbNotice, 5200);
                    }
                }));
            }
        }

        private async Task EnsureCompanionFormsAsync()
        {
            if (_orbForm != null && !_orbForm.IsDisposed) return;
            var tcs = new TaskCompletionSource<bool>();
            _mainForm.BeginInvoke(new Action(async () =>
            {
                var area = Screen.PrimaryScreen.WorkingArea;
                string miaoDir = Path.Combine(_clientDir, "miao");
                _orbForm = new LayeredPetOrbForm(miaoDir)
                {
                    Bounds = new Rectangle(area.Right - 254, area.Bottom - 280, 230, 256),
                    Icon = LoadAppIcon(),
                };
                _orbForm.OnTogglePanel = () =>
                {
                    var unused = HandleCompanionActionAsync("panel", "toggle");
                };
                _orbForm.OnMoved = () =>
                {
                    _autoDock = false;
                    if (_panelOpen) PlaceCompanionPanel();
                };
                _orbForm.OnPathsDropped = files =>
                {
                    var unused = HandleCompanionActionAsync("drop-paths", files);
                };
                _orbForm.OnDropChoice = choice =>
                {
                    var unused = HandleCompanionActionAsync("drop-choice", choice);
                };

                _panelForm = new ResizablePanelForm
                {
                    Text = "悬浮窗 · 剪映自动化",
                    FormBorderStyle = FormBorderStyle.None,
                    ShowInTaskbar = false,
                    TopMost = true,
                    StartPosition = FormStartPosition.Manual,
                    Size = new Size(390, 420),
                    Padding = new Padding(3),
                    BackColor = Color.FromArgb(16, 20, 26),
                    Icon = LoadAppIcon(),
                };
                Win32.EnableRoundedAndDark(_panelForm.Handle, true);
                _panelWebView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
                _panelForm.Controls.Add(_panelWebView);

                await InitWebViewAsync(_panelWebView, "main", string.Format("http://127.0.0.1:{0}/companion-panel.html?acrylic=1", AppPort), true);
                tcs.TrySetResult(true);
            }));
            await tcs.Task;
        }

        private void PlaceCompanionPanel()
        {
            if (_orbForm == null || _panelForm == null || _orbForm.IsDisposed || _panelForm.IsDisposed) return;
            var area = Screen.FromControl(_orbForm).WorkingArea;
            int x = _orbForm.Left - _panelForm.Width - 8;
            if (x < area.Left) x = _orbForm.Right + 8;
            int y = _orbForm.Bottom - _panelForm.Height;
            y = Math.Max(area.Top + 8, Math.Min(y, area.Bottom - _panelForm.Height - 8));
            x = Math.Max(area.Left + 8, Math.Min(x, area.Right - _panelForm.Width - 8));
            _panelForm.Location = new Point(x, y);
        }

        private async Task<Dictionary<string, object>> ShowCompanionAsync(bool openPanel)
        {
            await EnsureCompanionFormsAsync();
            _companionVisible = true;
            _mainForm.BeginInvoke(new Action(() =>
            {
                if (!_orbForm.Visible) _orbForm.Show();
                _orbForm.BringToFront();
                if (openPanel)
                {
                    _panelOpen = true;
                    PlaceCompanionPanel();
                    if (!_panelForm.Visible) _panelForm.Show();
                    _panelForm.BringToFront();
                    _panelForm.Activate();
                }
            }));
            return BroadcastCompanionState();
        }

        private Dictionary<string, object> HideCompanion()
        {
            _companionVisible = false;
            _panelOpen = false;
            _mainForm.BeginInvoke(new Action(() =>
            {
                if (_panelForm != null && !_panelForm.IsDisposed) _panelForm.Hide();
                if (_orbForm != null && !_orbForm.IsDisposed) _orbForm.Hide();
            }));
            return BroadcastCompanionState();
        }

        private async Task<object> HandleCompanionActionAsync(string action, object value)
        {
            if (action == "sync") return BroadcastCompanionState();
            if (action == "sync-providers")
            {
                if (value != null)
                {
                    _cachedProviders = value;
                    try { File.WriteAllText(Path.Combine(_userDataDir, "providers-cache.json"), _json.Serialize(value), Encoding.UTF8); } catch { }
                }
                return BroadcastCompanionState();
            }
            if (action == "show") return await ShowCompanionAsync(value != null && Convert.ToBoolean(value));
            if (action == "hide") return HideCompanion();
            if (action == "toggle")
            {
                if (!_companionVisible || !_panelOpen) return await ShowCompanionAsync(true);
                return HideCompanion();
            }
            if (action == "panel-drag")
            {
                _mainForm.BeginInvoke(new Action(() =>
                {
                    if (_panelForm != null && !_panelForm.IsDisposed)
                    {
                        Win32.ReleaseCapture();
                        Win32.SendMessage(_panelForm.Handle, Win32.WM_NCLBUTTONDOWN, (IntPtr)Win32.HTCAPTION, IntPtr.Zero);
                    }
                }));
                return BroadcastCompanionState();
            }
            if (action == "set-stage")
            {
                _activeCompanionStage = Convert.ToString(value ?? "export");
                return BroadcastCompanionState();
            }
            if (action == "toggle-pet-theme")
            {
                _petTheme = _petTheme == "dafeyu" ? "miao" : "dafeyu";
                _mainForm.BeginInvoke(new Action(() =>
                {
                    if (_orbForm != null && !_orbForm.IsDisposed)
                        _orbForm.SetPetTheme(_petTheme);
                }));
                NotifyOrbMessage(_petTheme == "dafeyu" ? "🐟 已切换为「大肥鱼」主题~" : "🐱 已切换回「月薪喵」主题~");
                return BroadcastCompanionState();
            }
            if (action == "prompt-drop")
            {
                _activeCompanionStage = Convert.ToString(value ?? _activeCompanionStage);
                NotifyOrbMessage("请把需要改名或加水印的文件/文件夹，直接拖放到我身上吧~ 🐾");
                return BroadcastCompanionState();
            }
            if (action == "drop-paths")
            {
                var rawList = new List<string>();
                if (value is string[]) rawList.AddRange((string[])value);
                else if (value is ArrayList)
                {
                    foreach (var item in (ArrayList)value) rawList.Add(Convert.ToString(item));
                }
                var expanded = ExpandDroppedPaths(rawList);
                if (expanded.Count == 0) throw new Exception("未在拖放内容中找到支持的视频或字幕文件。");
                _pendingDropFiles.Clear();
                _pendingDropFiles.AddRange(expanded);
                _mainForm.BeginInvoke(new Action(() =>
                {
                    if (_orbForm != null && !_orbForm.IsDisposed)
                        _orbForm.ShowChoicePrompt(_pendingDropFiles.Count);
                }));
                var st = BroadcastCompanionState();
                st["droppedFilesCount"] = _pendingDropFiles.Count;
                return st;
            }
            if (action == "drop-choice")
            {
                string choice = Convert.ToString(value ?? "");
                var files = _pendingDropFiles.ToArray();
                _pendingDropFiles.Clear();
                if (choice == "cancel" || files.Length == 0) return BroadcastCompanionState();
                if (choice == "rename")
                {
                    _renameFiles.Clear();
                    _renameFiles.AddRange(files);
                    _activeCompanionStage = "rename";
                    _forceStageToken = DateTime.UtcNow.Ticks.ToString();
                    await HandleJianyingActionAsync(new Dictionary<string, object>
                    {
                        { "action", "files" },
                        { "args", new Dictionary<string, object> { { "files", files } } }
                    });
                    try
                    {
                        await HandleJianyingActionAsync(new Dictionary<string, object>
                        {
                            { "action", "preview" },
                            { "args", new Dictionary<string, object> { { "folder", "" }, { "template", "短剧名称_第1集" }, { "ai", false } } }
                        });
                    }
                    catch { }
                    return await ShowCompanionAsync(true);
                }
                if (choice == "watermark")
                {
                    var videos = new List<string>();
                    foreach (string f in files)
                    {
                        if (VideoOnlyExts.Contains(Path.GetExtension(f))) videos.Add(f);
                    }
                    if (videos.Count == 0) throw new Exception("拖入的文件中没有可加水印的视频文件。");
                    _activeCompanionStage = "watermark";
                    AddWatermarkVideos(videos, true);
                    StartWatermarkBatch(true);
                    return BroadcastCompanionState();
                }
                return BroadcastCompanionState();
            }
            if (action == "panel" || action == "expand")
            {
                await EnsureCompanionFormsAsync();
                _panelOpen = Convert.ToString(value) == "toggle" ? !_panelOpen : Convert.ToBoolean(value);
                _mainForm.BeginInvoke(new Action(() =>
                {
                    if (_panelOpen)
                    {
                        PlaceCompanionPanel();
                        _panelForm.Show();
                        _panelForm.BringToFront();
                        _panelForm.Activate();
                    }
                    else
                    {
                        _panelForm.Hide();
                    }
                }));
                return BroadcastCompanionState();
            }
            if (action == "move-by" && value is Dictionary<string, object>)
            {
                var d = (Dictionary<string, object>)value;
                int dx = d.ContainsKey("dx") ? Convert.ToInt32(d["dx"]) : 0;
                int dy = d.ContainsKey("dy") ? Convert.ToInt32(d["dy"]) : 0;
                _autoDock = false;
                _mainForm.BeginInvoke(new Action(() =>
                {
                    if (_orbForm != null && !_orbForm.IsDisposed)
                    {
                        _orbForm.Location = new Point(_orbForm.Left + dx, _orbForm.Top + dy);
                        if (_panelOpen) PlaceCompanionPanel();
                    }
                }));
                return BroadcastCompanionState();
            }
            if (action == "toggle-dock") { _autoDock = !_autoDock; return BroadcastCompanionState(); }
            if (action == "toggle-period")
            {
                await Task.Run(() => _periodEngine.SetEnabled(!_periodEngine.Enabled, "compatible"));
                return BroadcastCompanionState();
            }
            if (action == "wm-add") { ChooseWatermarkVideos(); return BroadcastCompanionState(); }
            if (action == "wm-start") { StartWatermarkBatch(true); return BroadcastCompanionState(); }
            if (action == "wm-cancel") { await CancelWatermarkBatchAsync(); return BroadcastCompanionState(); }
            if (action == "wm-open") { OpenExplorerPath(Convert.ToString(value)); return BroadcastCompanionState(); }
            if (action == "jy-wizard")
            {
                var wArgs = value is Dictionary<string, object> ? (Dictionary<string, object>)value : new Dictionary<string, object>();
                await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "wizard" }, { "args", wArgs } });
                return BroadcastCompanionState();
            }
            if (action == "jy-rename-tpl")
            {
                var rArgs = value is Dictionary<string, object> ? (Dictionary<string, object>)value : new Dictionary<string, object>();
                await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "rename_template" }, { "args", rArgs } });
                return BroadcastCompanionState();
            }
            if (action == "jy-scan")
            {
                var scanPayload = new Dictionary<string, object> { { "action", "scan" } };
                var vDict = value as Dictionary<string, object>;
                if (vDict != null && vDict.ContainsKey("modelKey"))
                {
                    scanPayload["args"] = new Dictionary<string, object> { { "modelKey", vDict["modelKey"] } };
                }
                try { await HandleJianyingActionAsync(scanPayload); }
                catch { RestorePanelAfterScan(); throw; }
                return BroadcastCompanionState();
            }
            if (action == "jy-clear-rename-files")
            {
                _renameFiles.Clear();
                await HandleJianyingActionAsync(new Dictionary<string, object>
                {
                    { "action", "files" },
                    { "args", new Dictionary<string, object> { { "files", new string[0] } } }
                });
                return BroadcastCompanionState();
            }
            if (action == "wm-clear") { ClearWatermarkJobs("all"); return BroadcastCompanionState(); }
            if (action == "jy-export")
            {
                var args = value is Dictionary<string, object> ? (Dictionary<string, object>)value : new Dictionary<string, object>();
                await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "export" }, { "args", args } });
                return BroadcastCompanionState();
            }
            if (action == "jy-settings")
            {
                var args = value is Dictionary<string, object> ? (Dictionary<string, object>)value : new Dictionary<string, object>();
                await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "settings" }, { "args", args } });
                return BroadcastCompanionState();
            }
            if (action == "jy-select-tpl")
            {
                var args = value is Dictionary<string, object> ? (Dictionary<string, object>)value : new Dictionary<string, object>();
                await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "select-template" }, { "args", args } });
                return BroadcastCompanionState();
            }
            if (action == "jy-paths")
            {
                var args = value is Dictionary<string, object> ? (Dictionary<string, object>)value : new Dictionary<string, object>();
                await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "paths" }, { "args", args } });
                return BroadcastCompanionState();
            }
            if (action == "jy-pick-path")
            {
                string key = Convert.ToString(value) == "subtitleOutput" ? "subtitleOutput" : "draftDir";
                string dir = ChooseFolderDialog(key == "draftDir" ? "选择剪映草稿根目录 (JianyingPro Drafts)" : "选择 SRT 字幕导出目录");
                if (!string.IsNullOrEmpty(dir))
                {
                    await HandleJianyingActionAsync(new Dictionary<string, object>
                    {
                        { "action", "paths" },
                        { "args", new Dictionary<string, object> { { key, dir } } }
                    });
                }
                return BroadcastCompanionState();
            }
            if (action == "jy-extract") { await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "extract" } }); return BroadcastCompanionState(); }
            if (action == "jy-fonts") { await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "fonts" } }); return BroadcastCompanionState(); }
            if (action == "jy-punctuation") { await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "restore_punctuation" } }); return BroadcastCompanionState(); }
            if (action == "jy-unhide") { await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "unhide" } }); return BroadcastCompanionState(); }
            if (action == "jy-pick-rename-dir")
            {
                string dir = ChooseFolderDialog("选择要批量改名的文件夹（含子文件夹）");
                if (!string.IsNullOrEmpty(dir))
                {
                    var expanded = ExpandDroppedPaths(new string[] { dir });
                    if (expanded.Count > 0)
                    {
                        _renameFiles.Clear();
                        _renameFiles.AddRange(expanded);
                        await HandleJianyingActionAsync(new Dictionary<string, object>
                        {
                            { "action", "files" },
                            { "args", new Dictionary<string, object> { { "files", expanded.ToArray() } } }
                        });
                        try
                        {
                            await HandleJianyingActionAsync(new Dictionary<string, object>
                            {
                                { "action", "preview" },
                                { "args", new Dictionary<string, object> { { "folder", "" }, { "template", "短剧名称_第1集" }, { "ai", false } } }
                            });
                        }
                        catch { }
                    }
                    var st = BroadcastCompanionState();
                    st["renameFolder"] = dir;
                    return st;
                }
                return BroadcastCompanionState();
            }
            if (action == "jy-pick-rename-files")
            {
                string[] files = ChooseJianyingFiles();
                if (files != null && files.Length > 0)
                {
                    _renameFiles.Clear();
                    _renameFiles.AddRange(files);
                    await HandleJianyingActionAsync(new Dictionary<string, object>
                    {
                        { "action", "files" },
                        { "args", new Dictionary<string, object> { { "files", files } } }
                    });
                    try
                    {
                        await HandleJianyingActionAsync(new Dictionary<string, object>
                        {
                            { "action", "preview" },
                            { "args", new Dictionary<string, object> { { "folder", "" }, { "template", "短剧名称_第1集" }, { "ai", false } } }
                        });
                    }
                    catch { }
                }
                return BroadcastCompanionState();
            }
            if (action == "jy-preview-rename")
            {
                var args = value is Dictionary<string, object> ? (Dictionary<string, object>)value : new Dictionary<string, object>();
                bool isAi = args.ContainsKey("ai") && Convert.ToBoolean(args["ai"]);
                await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "preview" }, { "args", args } });
                if (isAi)
                {
                    var sw = Stopwatch.StartNew();
                    await Task.Delay(300);
                    while (IsJianyingBusy() && sw.ElapsedMilliseconds < 35000)
                    {
                        await Task.Delay(250);
                        await RefreshJianyingStatusAsync();
                    }
                }
                return BroadcastCompanionState();
            }
            if (action == "jy-execute-rename")
            {
                await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "rename" } });
                NotifyOrbMessage("✅ 批量改名已完成！✨");
                return BroadcastCompanionState();
            }
            if (action == "jy-stop") { await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "stop" } }); return BroadcastCompanionState(); }
            if (action == "jy-modal")
            {
                var args = value is Dictionary<string, object> ? (Dictionary<string, object>)value : new Dictionary<string, object>();
                await HandleJianyingActionAsync(new Dictionary<string, object> { { "action", "modal" }, { "args", args } });
                return BroadcastCompanionState();
            }
            if (action == "launch-jy") { LaunchJianyingExecutable(); return BroadcastCompanionState(); }
            if (action == "navigate")
            {
                _mainForm.BeginInvoke(new Action(() =>
                {
                    if (_mainForm.WindowState == FormWindowState.Minimized) _mainForm.WindowState = FormWindowState.Normal;
                    _mainForm.Show();
                    _mainForm.Activate();
                }));
                string target = Convert.ToString(value);
                if (!string.IsNullOrEmpty(target)) SendEventToMain("bos:tray-navigate", target);
                return BroadcastCompanionState();
            }
            return BroadcastCompanionState();
        }

        private Dictionary<string, object> BroadcastCompanionState()
        {
            var jy = _lastJianyingState ?? new Dictionary<string, object>();
            var jw = jy.ContainsKey("jianyingWindow") ? jy["jianyingWindow"] as Dictionary<string, object> : null;
            bool jyFound = jw != null && jw.ContainsKey("found") && Convert.ToBoolean(jw["found"]);
            object queueObj = jy.ContainsKey("queue") ? jy["queue"] : new object[0];
            int queueCount = 0;
            if (queueObj is ICollection) queueCount = ((ICollection)queueObj).Count;
            object logsObj = jy.ContainsKey("logs") ? jy["logs"] : new object[0];
            string lastLog = "等待指令…";
            if (logsObj is ArrayList && ((ArrayList)logsObj).Count > 0)
            {
                var arr = (ArrayList)logsObj;
                lastLog = Convert.ToString(arr[arr.Count - 1]);
            }
            else if (logsObj is object[] && ((object[])logsObj).Length > 0)
            {
                var arr = (object[])logsObj;
                lastLog = Convert.ToString(arr[arr.Length - 1]);
            }

            var snap = new Dictionary<string, object>
            {
                { "visible", _companionVisible },
                { "panelOpen", _panelOpen },
                { "autoDock", _autoDock },
                { "acrylic", true },
                { "activeStage", _activeCompanionStage },
                { "forceStageToken", _forceStageToken },
                { "petTheme", _petTheme },
                { "providers", _cachedProviders },
                { "pendingDropCount", _pendingDropFiles.Count },
                { "renameFiles", _renameFiles.ToArray() },
                { "orbNotice", _orbNotice },
                { "orbNoticeToken", _orbNoticeToken },
                { "jianyingFound", jyFound },
                { "jianyingWindow", jw ?? new Dictionary<string, object>() },
                { "jianying", new Dictionary<string, object>
                    {
                        { "ready", jy.ContainsKey("ready") && Convert.ToBoolean(jy["ready"]) },
                        { "busy", jy.ContainsKey("busy") && Convert.ToBoolean(jy["busy"]) },
                        { "exporting", jy.ContainsKey("exporting") && Convert.ToBoolean(jy["exporting"]) },
                        { "recording", jy.ContainsKey("recording") && Convert.ToBoolean(jy["recording"]) },
                        { "status", jy.ContainsKey("status") ? jy["status"] : "就绪" },
                        { "guide", jy.ContainsKey("guide") ? jy["guide"] : "" },
                        { "notice", jy.ContainsKey("notice") ? jy["notice"] : "" },
                        { "modal", jy.ContainsKey("modal") ? jy["modal"] : null },
                        { "extractProgress", jy.ContainsKey("extractProgress") ? jy["extractProgress"] : null },
                        { "queue", queueObj },
                        { "queueCount", queueCount },
                        { "plan", jy.ContainsKey("plan") ? jy["plan"] : new object[0] },
                        { "fileCount", jy.ContainsKey("fileCount") ? jy["fileCount"] : 0 },
                        { "mode", jy.ContainsKey("mode") ? jy["mode"] : "return_home" },
                        { "waits", jy.ContainsKey("waits") ? jy["waits"] : new Dictionary<string, object>() },
                        { "waitsReturnHome", jy.ContainsKey("waitsReturnHome") ? jy["waitsReturnHome"] : (jy.ContainsKey("waits") ? jy["waits"] : new Dictionary<string, object>()) },
                        { "waitsWaitClose", jy.ContainsKey("waitsWaitClose") ? jy["waitsWaitClose"] : (jy.ContainsKey("waits") ? jy["waits"] : new Dictionary<string, object>()) },
                        { "templates", jy.ContainsKey("templates") ? jy["templates"] : new object[0] },
                        { "templateId", jy.ContainsKey("templateId") ? jy["templateId"] : "" },
                        { "resolution", jy.ContainsKey("resolution") ? jy["resolution"] : new int[] { 1920, 1080 } },
                        { "draftDir", jy.ContainsKey("draftDir") ? jy["draftDir"] : "" },
                        { "subtitleOutput", jy.ContainsKey("subtitleOutput") ? jy["subtitleOutput"] : "" },
                        { "logs", logsObj },
                        { "lastLog", lastLog }
                    }
                },
                { "watermark", GetWatermarkSnapshot() },
                { "periodEnabled", _periodEngine != null && _periodEngine.Enabled }
            };
            SendEventToWebView(_panelWebView, "bos:companion-state", snap);
            return snap;
        }

        private void TickCompanion()
        {
            try { BrowserInput.RecoverCursor(_mainWebView); } catch { }
            // 引擎后台任务（如识别截图）进行中时主动轮询状态，防止 busy 标志卡死。
            if (IsJianyingBusy()) { var unused = RefreshJianyingStatusAsync(); }
            else if (_panelHiddenForScan) RestorePanelAfterScan();
            if (!_companionVisible || _orbForm == null || _orbForm.IsDisposed) return;

            if (_autoDock)
            {
                var jw = _lastJianyingState != null && _lastJianyingState.ContainsKey("jianyingWindow")
                    ? _lastJianyingState["jianyingWindow"] as Dictionary<string, object>
                    : null;
                if (jw != null && jw.ContainsKey("found") && Convert.ToBoolean(jw["found"]) && !Convert.ToBoolean(jw["minimized"]))
                {
                    int jx = Convert.ToInt32(jw["x"]);
                    int jy = Convert.ToInt32(jw["y"]);
                    int jwW = Convert.ToInt32(jw["width"]);
                    int jwH = Convert.ToInt32(jw["height"]);
                    if (jwW > 300 && jwH > 200)
                    {
                        int targetX = jx + jwW - _orbForm.Width - 12;
                        int targetY = jy + 12;
                        var scr = Screen.FromPoint(new Point(targetX, targetY));
                        targetX = Math.Max(scr.WorkingArea.Left, Math.Min(scr.WorkingArea.Right - _orbForm.Width, targetX));
                        targetY = Math.Max(scr.WorkingArea.Top, Math.Min(scr.WorkingArea.Bottom - _orbForm.Height, targetY));
                        if (Math.Abs(_orbForm.Left - targetX) > 2 || Math.Abs(_orbForm.Top - targetY) > 2)
                        {
                            RunOnUi(() =>
                            {
                                if (_orbForm != null && !_orbForm.IsDisposed)
                                {
                                    _orbForm.Location = new Point(targetX, targetY);
                                    if (_panelOpen && _panelForm != null && _panelForm.Visible)
                                    {
                                        PlaceCompanionPanel();
                                    }
                                }
                            }, false);
                        }
                    }
                }
            }

            BroadcastCompanionState();
        }

        private bool IsJianyingBusy()
        {
            var jy = _lastJianyingState;
            if (jy == null) return false;
            try
            {
                bool busy = jy.ContainsKey("busy") && Convert.ToBoolean(jy["busy"]);
                bool rec = jy.ContainsKey("recording") && Convert.ToBoolean(jy["recording"]);
                bool exp = jy.ContainsKey("exporting") && Convert.ToBoolean(jy["exporting"]);
                return busy || rec || exp;
            }
            catch { return false; }
        }

        private async Task RefreshJianyingStatusAsync()
        {
            if (_jianyingRpc == null) return;
            if (Interlocked.Exchange(ref _jyStatusPolling, 1) == 1) return;
            try
            {
                var res = await _jianyingRpc.CallAsync(new Dictionary<string, object> { { "action", "status" }, { "args", new Dictionary<string, object>() } }, 5000);
                if (res != null && res.ContainsKey("state") && res["state"] is Dictionary<string, object>)
                {
                    _lastJianyingState = (Dictionary<string, object>)res["state"];
                    SendEventToMain("bos:jianying-state", _lastJianyingState);
                    if (!IsJianyingBusy()) RestorePanelAfterScan();
                    BroadcastCompanionState();
                }
            }
            catch { }
            finally { Interlocked.Exchange(ref _jyStatusPolling, 0); }
        }

        private void RunOnUi(Action action, bool wait)
        {
            if (_mainForm == null || _mainForm.IsDisposed) return;
            try
            {
                if (!_mainForm.InvokeRequired) { action(); return; }
                if (wait) _mainForm.Invoke(action);
                else _mainForm.BeginInvoke(action);
            }
            catch { }
        }

        private void HidePanelForScan(bool wait)
        {
            RunOnUi(() =>
            {
                if (_panelForm != null && !_panelForm.IsDisposed && _panelForm.Visible)
                {
                    _panelHiddenForScan = true;
                    _panelForm.Hide();
                }
            }, wait);
        }

        private void RestorePanelAfterScan()
        {
            if (!_panelHiddenForScan) return;
            RunOnUi(() =>
            {
                if (!_panelHiddenForScan) return;
                _panelHiddenForScan = false;
                if (_panelOpen && _companionVisible && _panelForm != null && !_panelForm.IsDisposed)
                {
                    PlaceCompanionPanel();
                    _panelForm.Show();
                }
            }, false);
        }

        // ======================== Music Library & Materials ========================
        private Dictionary<string, object> ScanMusicLibrary()
        {
            var dirs = new List<Dictionary<string, object>>();
            var tracks = new List<Dictionary<string, object>>();
            _musicIdToPath.Clear();
            var exts = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg" };

            foreach (string root in _musicRoots.ToArray())
            {
                string libId = Sha256Hex(root.ToLowerInvariant());
                int count = 0;
                string err = "";
                try
                {
                    if (Directory.Exists(root))
                    {
                        foreach (string file in Directory.EnumerateFiles(root, "*.*", SearchOption.AllDirectories))
                        {
                            if (!exts.Contains(Path.GetExtension(file))) continue;
                            string id = Sha256Hex(file.ToLowerInvariant());
                            var fi = new FileInfo(file);
                            _musicIdToPath[id] = file;
                            tracks.Add(new Dictionary<string, object>
                            {
                                { "id", id },
                                { "libraryId", libId },
                                { "title", Path.GetFileNameWithoutExtension(file) },
                                { "relativePath", file.Substring(root.Length).TrimStart('\\', '/') },
                                { "size", fi.Length },
                                { "modifiedAt", (long)(fi.LastWriteTimeUtc - new DateTime(1970, 1, 1)).TotalMilliseconds }
                            });
                            count++;
                            if (tracks.Count >= 5000) break;
                        }
                    }
                }
                catch (Exception ex) { err = ex.Message; }
                dirs.Add(new Dictionary<string, object> { { "id", libId }, { "path", root }, { "count", count }, { "error", err } });
            }

            _musicCatalog = new Dictionary<string, object>
            {
                { "directories", dirs.ToArray() },
                { "tracks", tracks.ToArray() },
                { "scannedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() },
                { "revision", Guid.NewGuid().ToString("N").Substring(0, 12) },
                { "warning", "" }
            };
            return _musicCatalog;
        }

        private Dictionary<string, object> DownloadAudioFile(Dictionary<string, object> payload)
        {
            string url = Convert.ToString(payload["url"]);
            string dir = Convert.ToString(payload["directory"]);
            string fn = payload.ContainsKey("fileName") ? Convert.ToString(payload["fileName"]) : "配乐.mp3";
            Directory.CreateDirectory(dir);
            string stem = Regex.Replace(Path.GetFileNameWithoutExtension(fn), @"[<>:""/\\|?*]", "_");
            string outPath = Path.Combine(dir, stem + ".mp3");
            int n = 2;
            while (File.Exists(outPath)) { outPath = Path.Combine(dir, stem + "_" + (n++) + ".mp3"); }
            using (var wc = new WebClient())
            {
                wc.DownloadFile(url, outPath);
            }
            return new Dictionary<string, object> { { "ok", true }, { "path", outPath }, { "audioPath", outPath }, { "kind", "audio" } };
        }

        private Dictionary<string, object> ExportScriptMaterials(Dictionary<string, object> payload)
        {
            string dir = Convert.ToString(payload["directory"]);
            string title = Regex.Replace(Convert.ToString(payload["title"] ?? "剧本配乐"), @"[<>:""/\\|?*]", "_");
            string folder = Path.Combine(dir, title + "-" + Guid.NewGuid().ToString("N").Substring(0, 6));
            Directory.CreateDirectory(folder);

            string trackId = payload.ContainsKey("localTrackId") ? Convert.ToString(payload["localTrackId"]) : "";
            string trackPath;
            string audioOut = "";
            if (!string.IsNullOrEmpty(trackId) && _musicIdToPath.TryGetValue(trackId, out trackPath) && File.Exists(trackPath))
            {
                audioOut = Path.Combine(folder, "配乐" + Path.GetExtension(trackPath));
                File.Copy(trackPath, audioOut, true);
            }
            if (payload.ContainsKey("texts") && payload["texts"] is Dictionary<string, object>)
            {
                var texts = (Dictionary<string, object>)payload["texts"];
                foreach (var kv in texts)
                {
                    File.WriteAllText(Path.Combine(folder, kv.Key), Convert.ToString(kv.Value), Encoding.UTF8);
                }
            }
            return new Dictionary<string, object> { { "ok", true }, { "path", folder }, { "audioPath", audioOut } };
        }

        // ======================== Auto-Updater ========================
        private async Task<Dictionary<string, object>> CheckUpdaterAsync()
        {
            _updaterState["status"] = "checking";
            SendEventToMain("bos:updater-state", _updaterState);
            try
            {
                var res = await Task.Run(() => PerformHttpFetch(new Dictionary<string, object>
                {
                    { "url", "https://api.github.com/repos/Kirota233/XM-Editing-Studio/releases/latest" },
                    { "headers", new Dictionary<string, object> { { "Accept", "application/vnd.github+json" } } }
                }));
                if (Convert.ToBoolean(res["ok"]))
                {
                    var data = _json.Deserialize<Dictionary<string, object>>(Convert.ToString(res["body"]));
                    string tag = Convert.ToString(data["tag_name"] ?? CurrentVersion).TrimStart('v', 'V');
                    string dlUrl = "", assetName = "";
                    if (data.ContainsKey("assets") && data["assets"] is ArrayList)
                    {
                        foreach (Dictionary<string, object> a in (ArrayList)data["assets"])
                        {
                            string n = Convert.ToString(a["name"]);
                            if (n.EndsWith("Setup.exe", StringComparison.OrdinalIgnoreCase))
                            {
                                assetName = n;
                                dlUrl = Convert.ToString(a["browser_download_url"]);
                                break;
                            }
                        }
                    }
                    bool newer = string.CompareOrdinal(tag, CurrentVersion) > 0 && !string.IsNullOrEmpty(dlUrl);
                    _updaterState["latestVersion"] = tag;
                    _updaterState["hasUpdate"] = newer;
                    _updaterState["status"] = newer ? "available" : "up-to-date";
                    _updaterState["downloadUrl"] = dlUrl;
                    _updaterState["assetName"] = assetName;
                }
                else
                {
                    _updaterState["status"] = "up-to-date";
                }
            }
            catch (Exception ex)
            {
                _updaterState["status"] = "error";
                _updaterState["error"] = ex.Message;
            }
            SendEventToMain("bos:updater-state", _updaterState);
            return _updaterState;
        }

        private async Task<Dictionary<string, object>> DownloadUpdateAsync()
        {
            string dlUrl = Convert.ToString(_updaterState["downloadUrl"]);
            string assetName = Convert.ToString(_updaterState["assetName"]);
            if (string.IsNullOrEmpty(dlUrl)) return await CheckUpdaterAsync();
            _updaterState["status"] = "downloading";
            _updaterState["progress"] = 10;
            SendEventToMain("bos:updater-state", _updaterState);
            string updatesDir = Path.Combine(_userDataDir, "updates");
            Directory.CreateDirectory(updatesDir);
            string target = Path.Combine(updatesDir, assetName);
            await Task.Run(() =>
            {
                using (var wc = new WebClient())
                {
                    wc.Headers.Add("User-Agent", "XM-Editing-Studio/" + CurrentVersion);
                    wc.DownloadFile(dlUrl, target);
                }
            });
            _updaterState["status"] = "ready";
            _updaterState["progress"] = 100;
            _updaterState["installerPath"] = target;
            SendEventToMain("bos:updater-state", _updaterState);
            return _updaterState;
        }

        private Dictionary<string, object> InstallUpdate()
        {
            string installer = Convert.ToString(_updaterState["installerPath"]);
            if (!string.IsNullOrEmpty(installer) && File.Exists(installer))
            {
                _quitting = true;
                Process.Start(new ProcessStartInfo(installer) { UseShellExecute = true });
                _mainForm.BeginInvoke(new Action(() => _mainForm.Close()));
            }
            return new Dictionary<string, object> { { "ok", true } };
        }

        // ======================== Helpers & Tray ========================
        private void InitSystemTray()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("打开 XM剪辑台", null, (s, e) => { _mainForm.Show(); _mainForm.Activate(); });
            menu.Items.Add("召唤/隐藏 悬浮窗", null, async (s, e) => await HandleCompanionActionAsync("toggle", null));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("剪映自动化与样片水印", null, (s, e) => { _mainForm.Show(); _mainForm.Activate(); SendEventToMain("bos:tray-navigate", "jianying"); });
            menu.Items.Add("文案拆解与智能配乐", null, (s, e) => { _mainForm.Show(); _mainForm.Activate(); SendEventToMain("bos:tray-navigate", "workspace"); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("彻底退出 XM剪辑台", null, (s, e) => { _quitting = true; _mainForm.Close(); });

            _tray = new NotifyIcon
            {
                Icon = LoadAppIcon(),
                Text = "XM剪辑台 v" + CurrentVersion,
                ContextMenuStrip = menu,
                Visible = true
            };
            _tray.DoubleClick += (s, e) => { _mainForm.Show(); _mainForm.Activate(); };
        }

        private string ChooseFolderDialog(string description, string initialFolder = null)
        {
            string selected = "";
            _mainForm.Invoke(new Action(() =>
            {
                IntPtr owner = (_panelForm != null && _panelForm.Visible) ? _panelForm.Handle : _mainForm.Handle;
                selected = ModernFolderPicker.ShowDialog(owner, description, initialFolder);
            }));
            return selected;
        }

        private static void SetClipboardTextSafe(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            var t = new Thread(() => { try { Clipboard.SetText(text); } catch { } });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            t.Join(1500);
        }

        private static void OpenExplorerPath(string targetPath)
        {
            if (string.IsNullOrEmpty(targetPath)) return;
            try
            {
                string full = Path.GetFullPath(targetPath);
                if (File.Exists(full)) Process.Start("explorer.exe", "/select,\"" + full + "\"");
                else if (Directory.Exists(full)) Process.Start("explorer.exe", "\"" + full + "\"");
            }
            catch { }
        }

        private static void LaunchJianyingExecutable()
        {
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] candidates = new[]
            {
                Path.Combine(localApp, "JianyingPro", "Apps", "JianyingPro.exe"),
                Path.Combine(localApp, "JianyingPro", "JianyingPro.exe"),
                Path.Combine(localApp, "Programs", "JianyingPro", "JianyingPro.exe"),
            };
            foreach (var c in candidates)
            {
                if (File.Exists(c)) { try { Process.Start(c); return; } catch { } }
            }
        }

        private static string Sha256Hex(string input)
        {
            using (var sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
                var sb = new StringBuilder(64);
                foreach (byte b in hash) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        private void LoadSavedSettings()
        {
            try
            {
                string wmFile = Path.Combine(_userDataDir, "watermark-settings.json");
                if (File.Exists(wmFile))
                {
                    var d = _json.Deserialize<Dictionary<string, object>>(File.ReadAllText(wmFile, Encoding.UTF8));
                    if (d != null) foreach (var kv in d) _wmSettings[kv.Key] = kv.Value;
                }
                string mlFile = Path.Combine(_userDataDir, "music-library.json");
                if (File.Exists(mlFile))
                {
                    var d = _json.Deserialize<Dictionary<string, object>>(File.ReadAllText(mlFile, Encoding.UTF8));
                    if (d != null && d.ContainsKey("directories") && d["directories"] is ArrayList)
                    {
                        foreach (var dir in (ArrayList)d["directories"])
                        {
                            string s = Convert.ToString(dir);
                            if (!string.IsNullOrEmpty(s) && !_musicRoots.Contains(s)) _musicRoots.Add(s);
                        }
                    }
                    ScanMusicLibrary();
                }
            }
            catch { }
        }

        private void SaveSettings()
        {
            try
            {
                File.WriteAllText(Path.Combine(_userDataDir, "watermark-settings.json"), _json.Serialize(_wmSettings), Encoding.UTF8);
                File.WriteAllText(Path.Combine(_userDataDir, "music-library.json"), _json.Serialize(new Dictionary<string, object> { { "version", 1 }, { "directories", _musicRoots.ToArray() } }), Encoding.UTF8);
            }
            catch { }
        }

        private void DisposeAll()
        {
            try { if (_companionTimer != null) _companionTimer.Stop(); } catch { }
            try { if (_periodEngine != null) _periodEngine.Dispose(); } catch { }
            try { if (_tray != null) { _tray.Visible = false; _tray.Dispose(); } } catch { }
            try { if (_orbForm != null) _orbForm.Close(); } catch { }
            try { if (_panelForm != null) _panelForm.Close(); } catch { }
            try { if (_jianyingRpc != null) _jianyingRpc.Dispose(); } catch { }
            try { if (_watermarkRpc != null) _watermarkRpc.Dispose(); } catch { }
            try { if (_server != null) _server.Dispose(); } catch { }
            ExitThread();
        }
    }

    internal static class BrowserInput
    {
        private static Point? _lastPointer;
        [StructLayout(LayoutKind.Sequential)]
        private struct CursorInfo { internal int Size, Flags; internal IntPtr Cursor; internal Point Position; }
        [DllImport("user32.dll")] private static extern bool GetCursorInfo(ref CursorInfo info);
        [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern bool IsChild(IntPtr parent, IntPtr child);
        [DllImport("user32.dll")] private static extern IntPtr GetCapture();
        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SetCursor(IntPtr cursor);
        [DllImport("user32.dll")] private static extern IntPtr GetCursor();

        private static bool Owns(Control control, IntPtr handle)
        {
            return handle != IntPtr.Zero && control != null && !control.IsDisposed && control.IsHandleCreated && (handle == control.Handle || IsChild(control.Handle, handle));
        }

        internal static void Hide(Control page, Control main)
        {
            if (page == null || page.IsDisposed || !page.Visible) return;
            var window = main != null ? main.FindForm() : null;
            bool returnFocus = page.ContainsFocus && window != null && GetForegroundWindow() == window.Handle;
            if (Owns(page, GetCapture())) ReleaseCapture();
            page.Hide();
            if (returnFocus && main != null && main.Visible && main.CanFocus) main.Focus();
            RecoverCursor(main);
        }

        internal static bool RecoverCursor(Control main)
        {
            var info = new CursorInfo { Size = Marshal.SizeOf(typeof(CursorInfo)) };
            if (!GetCursorInfo(ref info)) return false;
            bool moved = _lastPointer.HasValue && _lastPointer.Value != info.Position;
            _lastPointer = info.Position;
            if (main == null || main.IsDisposed || !main.IsHandleCreated || !main.Visible) return false;
            var window = main.FindForm();
            if (window == null || !window.IsHandleCreated || GetForegroundWindow() != window.Handle) return false;
            if ((info.Flags & 2) != 0 || !Owns(main, WindowFromPoint(info.Position))) return false;
            if (GetCapture() != IntPtr.Zero) return false;
            if ((info.Flags & 1) != 0 && info.Cursor != IntPtr.Zero) return false;
            if (GetCursor() != IntPtr.Zero && !moved) return false;
            SetCursor(Cursors.Default.Handle);
            return true;
        }

        internal static async Task SendEnterAsync(CoreWebView2 core)
        {
            if (core == null) return;
            Exception failure = null;
            try
            {
                await core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", "{\"type\":\"keyDown\",\"key\":\"Enter\",\"code\":\"Enter\",\"windowsVirtualKeyCode\":13,\"text\":\"\\r\"}");
            }
            catch (Exception error) { failure = error; }
            await core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", "{\"type\":\"keyUp\",\"key\":\"Enter\",\"code\":\"Enter\",\"windowsVirtualKeyCode\":13}");
            if (failure != null) throw failure;
        }
    }

    internal static class Program
    {
        [STAThread]
        public static void Main()
        {
            bool createdNew;
            using (var mutex = new Mutex(true, "Global\\XiaomaEditingStudio_SingleInstance", out createdNew))
            {
                if (!createdNew) return;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new StudioAppContext());
            }
        }
    }
}
