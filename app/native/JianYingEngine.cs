using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class NativeWin32
{
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const byte VK_RETURN = 0x0D;
    public const int VK_F8 = 0x77;
    public const int VK_F9 = 0x78;
    public const int VK_F10 = 0x79;

    public static string GetForegroundProcessName()
    {
        try
        {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return "";
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == 0) return "";
            using (Process proc = Process.GetProcessById((int)pid))
            {
                return (proc.ProcessName ?? "").ToLowerInvariant() + ".exe";
            }
        }
        catch
        {
            return "";
        }
    }

    public static Dictionary<string, object> GetJianyingWindowInfo()
    {
        try
        {
            var procs = Process.GetProcessesByName("JianyingPro");
            try
            {
                foreach (var p in procs)
                {
                    IntPtr hwnd = p.MainWindowHandle;
                    if (hwnd == IntPtr.Zero) continue;
                    RECT r;
                    if (!GetWindowRect(hwnd, out r)) continue;
                    int w = r.Right - r.Left;
                    int h = r.Bottom - r.Top;
                    if (w <= 0 || h <= 0) continue;
                    bool minimized = IsIconic(hwnd);
                    bool fg = GetForegroundWindow() == hwnd;
                    return new Dictionary<string, object>
                    {
                        { "found", true },
                        { "minimized", minimized },
                        { "foreground", fg },
                        { "x", r.Left },
                        { "y", r.Top },
                        { "width", w },
                        { "height", h }
                    };
                }
            }
            finally
            {
                foreach (var p in procs) { try { p.Dispose(); } catch { } }
            }
        }
        catch { }
        return new Dictionary<string, object>
        {
            { "found", false },
            { "minimized", false },
            { "foreground", false },
            { "x", 0 },
            { "y", 0 },
            { "width", 0 },
            { "height", 0 }
        };
    }

    public static void ClickAt(int x, int y)
    {
        SetCursorPos(x, y);
        Thread.Sleep(25);
        mouse_event(MOUSEEVENTF_LEFTDOWN, (uint)x, (uint)y, 0, UIntPtr.Zero);
        Thread.Sleep(25);
        mouse_event(MOUSEEVENTF_LEFTUP, (uint)x, (uint)y, 0, UIntPtr.Zero);
    }

    public static void PressEnter()
    {
        keybd_event(VK_RETURN, 0, 0, UIntPtr.Zero);
        Thread.Sleep(25);
        keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}

internal sealed class AiRequestSlot
{
    public readonly ManualResetEventSlim Event = new ManualResetEventSlim(false);
    public string Text = "";
    public string Error = "";
}

internal sealed partial class JianYingEngine
{
    private readonly string _dataDir;
    private readonly string _cfgFile;
    private readonly string _deletedTemplateDir;
    private readonly object _lock = new object();
    private readonly object _writeLock = new object();
    private readonly JavaScriptSerializer _json;

    private string _status = "引擎就绪";
    private readonly List<string> _logs = new List<string>();
    private List<Dictionary<string, object>> _queue = new List<Dictionary<string, object>>();
    private List<Dictionary<string, object>> _plan = new List<Dictionary<string, object>>();
    private Dictionary<string, object> _modal = null;
    private Action _modalCallback = null;
    private string _notice = "";
    private string _guide = "请先录制坐标";

    private bool _busy = false;
    private bool _exportActive = false;
    private bool _stopFlag = false;
    private int _operationGeneration = 0;

    private string _recState = null;
    private Dictionary<string, int[]> _recordingCoords = null;
    private int[] _recordingColor = null;
    private string _recordingTemplateName = null;
    private string _recordingTemplatePath = null;

    private string _exportMode = "return_home";
    private readonly Dictionary<string, double> _stepWaits = new Dictionary<string, double>
    {
        { "open_draft", 8.0 },
        { "export", 3.0 },
        { "confirm", 1.0 },
        { "popup_close", 1.5 },
        { "close_btn", 2.0 },
        { "draft_close", 1.5 }
    };

    private Dictionary<string, int[]> _coords = new Dictionary<string, int[]>
    {
        { "export", null },
        { "confirm", null },
        { "popup_close", null },
        { "close_btn", null },
        { "draft_close", null }
    };
    private int[] _closeColor = null;
    private string _activeTemplateName = null;
    private string _activeTemplatePath = "";
    private int[] _templateResolution = null;
    private bool _resolutionMismatch = false;

    private string _draftDir = "";
    private string _subtitleOutput = "";
    private List<string> _selectedFiles = new List<string>();
    private readonly HashSet<string> _encryptedDrafts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    private List<Tuple<int, int, string>> _drafts = new List<Tuple<int, int, string>>();
    private readonly Dictionary<string, AiRequestSlot> _aiRequests = new Dictionary<string, AiRequestSlot>();
    private volatile bool _disposed = false;
    private readonly Thread _hotkeyThread;

    public JianYingEngine(string dataDir)
    {
        _json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        _dataDir = Path.GetFullPath(dataDir);
        Directory.CreateDirectory(_dataDir);
        _cfgFile = Path.Combine(_dataDir, "settings.json");
        _deletedTemplateDir = Path.Combine(_dataDir, "deleted_templates");
        _subtitleOutput = Path.Combine(_dataDir, "字幕导出");

        LoadConfig();
        if (!string.IsNullOrEmpty(_activeTemplatePath) && File.Exists(_activeTemplatePath))
        {
            LoadCoordinateTemplate(_activeTemplatePath);
        }
        else
        {
            var records = GetCoordinateTemplateRecords();
            if (records.Count > 0)
            {
                LoadCoordinateTemplate((string)records[0]["path"]);
            }
        }
        RefreshGuideBadge();
        SaveConfig();

        _hotkeyThread = new Thread(HotkeyLoop) { IsBackground = true, Name = "JianYingHotkeys" };
        _hotkeyThread.Start();
    }

    public void Send(object payload)
    {
        lock (_writeLock)
        {
            Console.Out.WriteLine(_json.Serialize(payload));
            Console.Out.Flush();
        }
    }

    private int[] GetScreenResolution()
    {
        Rectangle bounds = Screen.PrimaryScreen != null ? Screen.PrimaryScreen.Bounds : new Rectangle(0, 0, 1920, 1080);
        return new int[] { bounds.Width, bounds.Height };
    }

    private void Log(string message)
    {
        lock (_lock)
        {
            string line = DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + " " + message;
            _logs.Add(line);
            if (_logs.Count > 160)
            {
                _logs.RemoveRange(0, _logs.Count - 160);
            }
        }
    }

    private void ShowNotice(string title, string detail)
    {
        lock (_lock)
        {
            _notice = string.IsNullOrEmpty(detail) ? title : (title + "：" + detail);
        }
    }

    private void AtomicWriteJson(string path, object data)
    {
        string dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        string temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            string text = _json.Serialize(data);
            File.WriteAllText(temp, text, new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(temp, path, null);
            else File.Move(temp, path);
        }
        finally
        {
            if (File.Exists(temp))
            {
                try { File.Delete(temp); } catch { }
            }
        }
    }

    private void LoadConfig()
    {
        if (!File.Exists(_cfgFile)) return;
        try
        {
            var data = _json.Deserialize<Dictionary<string, object>>(File.ReadAllText(_cfgFile, Encoding.UTF8));
            if (data == null) return;
            string mode = data.ContainsKey("export_mode") ? Convert.ToString(data["export_mode"]) : "";
            _exportMode = (mode == "return_home" || mode == "wait_close") ? mode : "return_home";

            if (data.ContainsKey("step_waits") && data["step_waits"] is IDictionary)
            {
                var waits = (IDictionary)data["step_waits"];
                foreach (var key in _stepWaits.Keys.ToList())
                {
                    if (waits.Contains(key))
                    {
                        double val;
                        if (double.TryParse(Convert.ToString(waits[key], CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out val)
                            && !double.IsNaN(val) && !double.IsInfinity(val) && val >= 0.1 && val <= 600.0)
                        {
                            _stepWaits[key] = Math.Round(val, 1);
                        }
                    }
                }
            }
            string tpl = data.ContainsKey("template") ? Path.GetFileName(Convert.ToString(data["template"])) : "";
            _activeTemplatePath = !string.IsNullOrEmpty(tpl) ? Path.Combine(_dataDir, tpl) : "";
            _draftDir = data.ContainsKey("draft_dir") ? Convert.ToString(data["draft_dir"]) ?? "" : "";
            string subOut = data.ContainsKey("subtitle_output") ? Convert.ToString(data["subtitle_output"]) : "";
            if (!string.IsNullOrWhiteSpace(subOut)) _subtitleOutput = subOut;
        }
        catch
        {
        }
    }

    private bool SaveConfig()
    {
        try
        {
            var payload = new Dictionary<string, object>
            {
                { "export_mode", _exportMode },
                { "step_waits", _stepWaits },
                { "template", !string.IsNullOrEmpty(_activeTemplatePath) ? Path.GetFileName(_activeTemplatePath) : "" },
                { "draft_dir", _draftDir ?? "" },
                { "subtitle_output", _subtitleOutput ?? "" }
            };
            AtomicWriteJson(_cfgFile, payload);
            return true;
        }
        catch
        {
            Log("参数保存失败，请检查目录权限或磁盘空间。");
            return false;
        }
    }

    private List<Dictionary<string, object>> GetCoordinateTemplateRecords()
    {
        var list = new List<Dictionary<string, object>>();
        try
        {
            if (!Directory.Exists(_dataDir)) return list;
            foreach (string file in Directory.GetFiles(_dataDir, "*.json").OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
            {
                string name = Path.GetFileName(file);
                if (string.Equals(name, "settings.json", StringComparison.OrdinalIgnoreCase) ||
                    name.StartsWith("rename-", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                var rec = ReadCoordinateTemplateRecord(file);
                if (rec != null) list.Add(rec);
            }
        }
        catch { }
        return list;
    }

    private Dictionary<string, object> ReadCoordinateTemplateRecord(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            var data = _json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path, Encoding.UTF8));
            if (data == null || !data.ContainsKey("coords") || !data.ContainsKey("screen_resolution")) return null;
            string tName = data.ContainsKey("template_name") ? Convert.ToString(data["template_name"]).Trim() : Path.GetFileNameWithoutExtension(path);
            if (string.IsNullOrEmpty(tName)) tName = Path.GetFileNameWithoutExtension(path);
            return new Dictionary<string, object>
            {
                { "id", Path.GetFileName(path) },
                { "name", tName },
                { "path", Path.GetFullPath(path) },
                { "data", data }
            };
        }
        catch
        {
            return null;
        }
    }

    private Dictionary<string, int[]> NormalizeCoordinates(object rawCoords)
    {
        var result = new Dictionary<string, int[]>
        {
            { "export", null },
            { "confirm", null },
            { "popup_close", null },
            { "close_btn", null },
            { "draft_close", null }
        };
        var dict = rawCoords as IDictionary;
        if (dict == null) return result;
        foreach (string key in result.Keys.ToList())
        {
            if (!dict.Contains(key) || dict[key] == null) continue;
            var arr = dict[key] as IList;
            if (arr != null && arr.Count == 2)
            {
                result[key] = new int[] { Convert.ToInt32(arr[0]), Convert.ToInt32(arr[1]) };
            }
        }
        return result;
    }

    private bool LoadCoordinateTemplate(string path)
    {
        var rec = ReadCoordinateTemplateRecord(path);
        if (rec == null) return false;
        try
        {
            var data = (Dictionary<string, object>)rec["data"];
            _coords = NormalizeCoordinates(data["coords"]);
            var resList = data["screen_resolution"] as IList;
            if (resList == null || resList.Count != 2) return false;
            _templateResolution = new int[] { Convert.ToInt32(resList[0]), Convert.ToInt32(resList[1]) };
            if (data.ContainsKey("color") && data["color"] is IList)
            {
                var c = (IList)data["color"];
                if (c.Count == 3) _closeColor = new int[] { Convert.ToInt32(c[0]), Convert.ToInt32(c[1]), Convert.ToInt32(c[2]) };
            }
            _activeTemplateName = Convert.ToString(rec["name"]);
            _activeTemplatePath = Convert.ToString(rec["path"]);
            int[] sysRes = GetScreenResolution();
            _resolutionMismatch = (_templateResolution[0] != sysRes[0] || _templateResolution[1] != sysRes[1]);
            RefreshGuideBadge();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private bool SaveCoordinateTemplate(string templateName, string templatePath)
    {
        try
        {
            if (string.IsNullOrEmpty(templateName) || string.IsNullOrEmpty(templatePath))
            {
                var next = NextCoordinateTemplateIdentity();
                templateName = next.Item1;
                templatePath = next.Item2;
            }
            int[] sysRes = GetScreenResolution();
            var payload = new Dictionary<string, object>
            {
                { "template_version", 1 },
                { "template_name", templateName },
                { "screen_resolution", sysRes },
                { "coords", _coords },
                { "color", _closeColor },
                { "saved_at", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) }
            };
            AtomicWriteJson(templatePath, payload);
            _activeTemplateName = templateName;
            _activeTemplatePath = Path.GetFullPath(templatePath);
            _templateResolution = sysRes;
            _resolutionMismatch = false;
            SaveConfig();
            RefreshGuideBadge();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private Tuple<string, string> NextCoordinateTemplateIdentity()
    {
        int n = 1;
        while (File.Exists(Path.Combine(_dataDir, "模板" + n + ".json")))
        {
            n++;
        }
        return Tuple.Create("模板" + n, Path.Combine(_dataDir, "模板" + n + ".json"));
    }

    private bool ModeCoordsReady(string mode = null)
    {
        string m = mode ?? _exportMode;
        string[] required = m == "wait_close"
            ? new[] { "export", "confirm", "close_btn", "draft_close" }
            : new[] { "export", "confirm", "popup_close" };
        int[] sysRes = GetScreenResolution();
        foreach (string key in required)
        {
            if (!_coords.ContainsKey(key) || _coords[key] == null || _coords[key].Length != 2) return false;
        }
        foreach (var pt in _coords.Values)
        {
            if (pt == null) continue;
            if (pt.Length != 2 || pt[0] < 0 || pt[0] >= sysRes[0] || pt[1] < 0 || pt[1] >= sysRes[1]) return false;
        }
        return true;
    }

    private void RefreshGuideBadge()
    {
        if (_recState != null) return;
        if (_resolutionMismatch)
        {
            _guide = "⚠ 当前屏幕分辨率与坐标模板不一致，请重新录制坐标";
        }
        else if (ModeCoordsReady())
        {
            _guide = "✓ 已载入坐标模板：" + (_activeTemplateName ?? Path.GetFileNameWithoutExtension(_activeTemplatePath));
        }
        else
        {
            _guide = "请先录制坐标";
        }
    }

    public Dictionary<string, object> Snapshot()
    {
        lock (_lock)
        {
            var templates = GetCoordinateTemplateRecords()
                .Select(r => new Dictionary<string, object> { { "id", r["id"] }, { "name", r["name"] } })
                .ToList();
            string tplId = !string.IsNullOrEmpty(_activeTemplatePath) && File.Exists(_activeTemplatePath)
                ? Path.GetFileName(_activeTemplatePath)
                : "";
            return new Dictionary<string, object>
            {
                { "status", _status },
                { "logs", _logs.ToList() },
                { "queue", _queue.ToList() },
                { "plan", _plan.ToList() },
                { "modal", _modal },
                { "notice", _notice },
                { "guide", _guide },
                { "ready", true },
                { "busy", _busy },
                { "recording", _recState != null },
                { "recordingError", _recordingError },
                { "recordingProgress", _recordingProgress == null ? null : new Dictionary<string, object>(_recordingProgress) },
                { "scanProgress", _scanProgress == null ? null : new Dictionary<string, object>(_scanProgress) },
                { "exportProgress", _exportProgress == null ? null : new Dictionary<string, object>(_exportProgress) },
                { "exporting", _exportActive },
                { "mode", _exportMode },
                { "waits", new Dictionary<string, double>(_stepWaits) },
                { "templates", templates },
                { "templateId", tplId },
                { "resolution", GetScreenResolution() },
                { "coordinatesReady", ModeCoordsReady() && !_resolutionMismatch },
                { "draftDir", _draftDir ?? "" },
                { "subtitleOutput", _subtitleOutput ?? "" },
                { "fileCount", _selectedFiles.Count },
                { "jianyingWindow", NativeWin32.GetJianyingWindowInfo() }
            };
        }
    }

    private void HotkeyLoop()
    {
        bool prevF8 = false, prevF9 = false, prevF10 = false;
        while (!_disposed)
        {
            try
            {
                bool f8 = (NativeWin32.GetAsyncKeyState(NativeWin32.VK_F8) & 0x8000) != 0;
                bool f9 = (NativeWin32.GetAsyncKeyState(NativeWin32.VK_F9) & 0x8000) != 0;
                bool f10 = (NativeWin32.GetAsyncKeyState(NativeWin32.VK_F10) & 0x8000) != 0;

                if (f10 && !prevF10) OnKeyF10();
                if (f8 && !prevF8) OnKeyF8();
                if (f9 && !prevF9) OnKeyF9();

                prevF8 = f8;
                prevF9 = f9;
                prevF10 = f10;
            }
            catch { }
            Thread.Sleep(30);
        }
    }

    private void OnKeyF10()
    {
        StopOperation("F10");
    }

    private void OnKeyF9()
    {
        lock (_lock)
        {
            if (_recState == "popup_close" && _exportMode == "wait_close" && _recordingCoords != null && _recordingCapture == null)
            {
                _recordingCoords["popup_close"] = null;
                Log("  ↪ 已跳过收起至首页坐标，继续录制后续步骤");
                AdvanceRecording();
            }
        }
    }

    private void AdvanceRecording()
    {
        if (_exportMode == "return_home")
        {
            if (_recState == "export")
            {
                _recState = "confirm";
                _guide = "2/3 点导出呼出弹窗 → 鼠标在【确认导出】上 → F8";
            }
            else if (_recState == "confirm")
            {
                _recState = "popup_close";
                _guide = "3/3 鼠标放在【收起至首页】上 → F8 结束录制保存模板";
            }
            else
            {
                FinishRecording();
            }
        }
        else
        {
            if (_recState == "export")
            {
                _recState = "confirm";
                _guide = "2/4 点导出呼出弹窗 → 鼠标在【确认导出】上 → F8";
            }
            else if (_recState == "confirm")
            {
                _recState = "popup_close";
                _guide = "等待完成关闭模式请按 F9，继续录制关闭按钮";
            }
            else if (_recState == "popup_close")
            {
                _recState = "close_btn";
                _guide = "3/4 鼠标在导出完成后的【关闭(X)】按钮上 → F8";
            }
            else if (_recState == "close_btn")
            {
                _recState = "draft_close";
                _guide = "4/4 鼠标放在【关闭草稿/返回首页】上 → 按 F8结束录制并保存模板";
            }
            else
            {
                FinishRecording();
            }
        }
        SyncRecordingProgress();
    }

    private void FinishRecording()
    {
        _coords = _recordingCoords;
        _closeColor = _recordingColor;
        string tName = _recordingTemplateName;
        string tPath = _recordingTemplatePath;
        _recState = null;
        _recordingCoords = null;
        _recordingColor = null;
        _recordingTemplateName = null;
        _recordingTemplatePath = null;
        if (SaveCoordinateTemplate(tName, tPath))
        {
            Log("向导完成，【" + _activeTemplateName + "】已保存");
            ShowNotice("坐标模板已保存", _activeTemplateName + " 将在下次启动时自动载入");
            _recordingProgress["completed"] = _recordingProgress["total"];
            _recordingProgress["current"] = _recordingProgress["total"];
            _recordingProgress["step"] = ""; _recordingProgress["skipAvailable"] = false;
            EmitProgress(_recordingProgress, "recording-progress", "complete", "录制完成，" + _activeTemplateName + " 已保存");
        }
        else
        {
            _guide = "● 模板保存失败";
            ShowNotice("模板保存失败", "坐标未能写入本地");
            EmitProgress(_recordingProgress, "recording-progress", "error", "坐标模板保存失败，请返回工作台查看日志并重新录制");
        }
    }

    private void StopOperation(string source = "中断按钮")
    {
        lock (_lock)
        {
            _stopFlag = true;
            _operationGeneration++;
            bool hadRecording = _recState != null;
            if (hadRecording) EmitProgress(_recordingProgress, "recording-progress", "cancelled", (source == "F10" ? "已按 F10 结束录制" : "录制已结束") + "，原坐标模板已保留");
            if (_exportActive)
            {
                _lastStopSource = source;
                EmitProgress(_exportProgress, "export-progress", "stopping", source == "F10" ? "已收到 F10，正在结束运行" : "已收到中断请求，正在结束运行");
            }
            _recState = null;
            _recordingCoords = null;
            _recordingColor = null;
            _recordingTemplateName = null;
            _recordingTemplatePath = null;
            _modal = null;
            _modalCallback = null;
            _status = "已中断";
            RefreshGuideBadge();
            foreach (var slot in _aiRequests.Values)
            {
                slot.Error = "用户中断";
                slot.Event.Set();
            }
            Log(hadRecording ? (source + "：坐标录制已取消") : (source + "：当前操作已收到中断信号"));
        }
    }

    private void CheckInterrupted(int expectedGeneration)
    {
        lock (_lock)
        {
            if (_stopFlag || expectedGeneration != _operationGeneration)
            {
                throw new OperationCanceledException("用户中断");
            }
        }
    }

    private void InterruptibleWait(double seconds, int gen)
    {
        Stopwatch sw = Stopwatch.StartNew();
        double targetMs = seconds * 1000.0;
        while (sw.Elapsed.TotalMilliseconds < targetMs)
        {
            CheckInterrupted(gen);
            int sleepMs = (int)Math.Min(100.0, Math.Max(10.0, targetMs - sw.Elapsed.TotalMilliseconds));
            Thread.Sleep(sleepMs);
        }
    }

    private void BeginOperation(Action<int> target)
    {
        int gen;
        lock (_lock)
        {
            if (_busy) throw new InvalidOperationException("当前任务尚未结束，请等待或中断。");
            _busy = true;
            _stopFlag = false;
            gen = ++_operationGeneration;
        }
        ThreadPool.QueueUserWorkItem(_ =>
        {
            try
            {
                target(gen);
            }
            catch (OperationCanceledException)
            {
                Log("任务已中断");
                lock (_lock) { _status = "已中断"; }
            }
            catch (Exception ex)
            {
                Log(ex.Message);
                lock (_lock) { _notice = ex.Message; }
            }
            finally
            {
                lock (_lock)
                {
                    _busy = false;
                    _exportActive = false;
                }
            }
        });
    }

    private void AskYesNo(string title, string message, Action onYes)
    {
        lock (_lock)
        {
            _modalCallback = onYes;
            _modal = new Dictionary<string, object>
            {
                { "id", Guid.NewGuid().ToString("N") },
                { "title", title },
                { "message", message }
            };
        }
    }

    private void RequireJianyingForeground()
    {
        string proc = NativeWin32.GetForegroundProcessName();
        if (!string.Equals(proc, "jianyingpro.exe", StringComparison.OrdinalIgnoreCase))
        {
            string shown = string.IsNullOrEmpty(proc) ? "未知程序" : proc;
            throw new InvalidOperationException("为防止误点，自动化已停止：当前前台是 " + shown + "，不是 JianyingPro.exe");
        }
    }

    private static bool IsJianyingRunning()
    {
        try
        {
            return Process.GetProcessesByName("JianyingPro").Length > 0;
        }
        catch
        {
            return false;
        }
    }

    private static int[] GetPixelRgb(int x, int y)
    {
        try
        {
            using (Bitmap bmp = new Bitmap(1, 1, PixelFormat.Format24bppRgb))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.CopyFromScreen(x, y, 0, 0, new Size(1, 1));
                }
                Color c = bmp.GetPixel(0, 0);
                return new int[] { c.R, c.G, c.B };
            }
        }
        catch
        {
            return new int[] { 0, 0, 0 };
        }
    }

    private static string CaptureScreenJpegBase64()
    {
        Rectangle bounds = Screen.PrimaryScreen != null ? Screen.PrimaryScreen.Bounds : new Rectangle(0, 0, 1920, 1080);
        using (Bitmap screen = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
        {
            using (Graphics g = Graphics.FromImage(screen))
            {
                g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size);
            }
            Bitmap target = screen;
            try
            {
                if (screen.Width > 2560 || screen.Height > 2560)
                {
                    double ratio = Math.Min(2560.0 / screen.Width, 2560.0 / screen.Height);
                    int w = Math.Max(1, (int)Math.Round(screen.Width * ratio));
                    int h = Math.Max(1, (int)Math.Round(screen.Height * ratio));
                    target = new Bitmap(screen, new Size(w, h));
                }
                using (MemoryStream ms = new MemoryStream())
                {
                    ImageCodecInfo jpegCodec = ImageCodecInfo.GetImageDecoders().FirstOrDefault(c => c.FormatID == ImageFormat.Jpeg.Guid);
                    if (jpegCodec != null)
                    {
                        using (EncoderParameters ep = new EncoderParameters(1))
                        {
                            ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 88L);
                            target.Save(ms, jpegCodec, ep);
                        }
                    }
                    else
                    {
                        target.Save(ms, ImageFormat.Jpeg);
                    }
                    return Convert.ToBase64String(ms.ToArray());
                }
            }
            finally
            {
                if (!ReferenceEquals(target, screen)) target.Dispose();
            }
        }
    }

    private string RequestAiText(string prompt, string base64Image, int gen)
    {
        string token = Guid.NewGuid().ToString("N");
        var slot = new AiRequestSlot();
        lock (_lock)
        {
            _aiRequests[token] = slot;
        }
        Send(new Dictionary<string, object>
        {
            { "event", "ai" },
            { "token", token },
            { "prompt", prompt },
            { "image", base64Image }
        });
        try
        {
            Stopwatch sw = Stopwatch.StartNew();
            while (!slot.Event.Wait(100))
            {
                CheckInterrupted(gen);
                if (sw.Elapsed.TotalSeconds > (_webScan ? 510 : 150))
                {
                    throw new TimeoutException("AI 请求超时，请重试。");
                }
            }
            CheckInterrupted(gen);
            if (!string.IsNullOrEmpty(slot.Error))
            {
                throw new InvalidOperationException(slot.Error);
            }
            return slot.Text ?? "";
        }
        finally
        {
            lock (_lock)
            {
                _aiRequests.Remove(token);
            }
        }
    }

    private void RunExportLoop(int startIndex, string mode, int gen)
    {
        int? currentIndex = null;
        try
        {
            Dictionary<string, double> waits;
            List<Tuple<int, int, string>> drafts;
            Dictionary<string, int[]> coords;
            lock (_lock)
            {
                _exportActive = true;
                waits = new Dictionary<string, double>(_stepWaits);
                drafts = _drafts.ToList();
                coords = new Dictionary<string, int[]>(_coords);
            }
            int total = drafts.Count;
            int count = total - startIndex;
            BeginExportProgress(startIndex, mode, drafts, coords);
            CheckInterrupted(gen);
            ValidateDraftQueue();
            string modeName = mode == "return_home" ? "收起至首页" : "等待完成关闭";
            Log(string.Format("开始导出【{0}】：共 {1} 个", modeName, count));
            InterruptibleWait(0.8, gen);

            for (int i = startIndex; i < total; i++)
            {
                currentIndex = i;
                CheckInterrupted(gen);
                var d = drafts[i];
                UpdateQueueStatus(i, "▶ 处理中");
                ExportStep(i - startIndex + 1, d.Item3, false);
                lock (_lock) { _status = string.Format("导出 {0}/{1}", i - startIndex + 1, count); }
                Log(string.Format("[{0}/{1}] {2}", i + 1, total, d.Item3));

                SafeClick(d.Item1, d.Item2, gen);
                InterruptibleWait(waits["open_draft"], gen);

                SafeClick(coords["export"][0], coords["export"][1], gen);
                InterruptibleWait(waits["export"], gen);

                SafeClick(coords["confirm"][0], coords["confirm"][1], gen);
                InterruptibleWait(waits["confirm"], gen);

                CheckInterrupted(gen);
                RequireJianyingForeground();
                NativeWin32.PressEnter();

                WaitExportDone(mode, coords, gen);
                CheckInterrupted(gen);

                if (mode == "return_home")
                {
                    SafeClick(coords["popup_close"][0], coords["popup_close"][1], gen);
                    InterruptibleWait(waits["popup_close"], gen);
                }
                else
                {
                    SafeClick(coords["close_btn"][0], coords["close_btn"][1], gen);
                    InterruptibleWait(waits["close_btn"], gen);
                    SafeClick(coords["draft_close"][0], coords["draft_close"][1], gen);
                    InterruptibleWait(waits["draft_close"], gen);
                }
                UpdateQueueStatus(i, "完成");
                ExportStep(i - startIndex + 1, d.Item3, true);
                currentIndex = null;
            }
            FinishExportProgress(mode, null);
        }
        catch (Exception ex)
        {
            if (currentIndex.HasValue) UpdateQueueStatus(currentIndex.Value, ex is OperationCanceledException ? "已中断" : "失败");
            FinishExportProgress(mode, ex);
        }
    }

    private void WaitExportDone(string mode, Dictionary<string, int[]> coords, int gen)
    {
        InterruptibleWait(0.5, gen);
        Stopwatch sw = Stopwatch.StartNew();
        int streak = 0;
        while (sw.Elapsed.TotalSeconds < 1800)
        {
            CheckInterrupted(gen);
            if (mode == "return_home" && coords["popup_close"] != null)
            {
                int px = coords["popup_close"][0];
                int py = coords["popup_close"][1];
                int[] rgb = GetPixelRgb(px, py);
                if (rgb[0] < 80 && rgb[1] > 130 && rgb[2] > 130)
                {
                    return;
                }
            }
            else if (mode == "wait_close" && coords["close_btn"] != null)
            {
                int cx = coords["close_btn"][0];
                int cy = coords["close_btn"][1];
                int[] rgb = GetPixelRgb(cx, cy);
                int maxB = Math.Max(rgb[0], Math.Max(rgb[1], rgb[2]));
                if (maxB > 140)
                {
                    streak++;
                    if (streak >= 2) return;
                }
                else
                {
                    streak = 0;
                }
            }
            InterruptibleWait(1.0, gen);
        }
        throw new TimeoutException("等待导出完成超时（30 分钟）");
    }

    private void SafeClick(int x, int y, int gen)
    {
        CheckInterrupted(gen);
        RequireJianyingForeground();
        NativeWin32.ClickAt(x, y);
    }

    private void UpdateQueueStatus(int index, string status)
    {
        lock (_lock)
        {
            if (index >= 0 && index < _queue.Count)
            {
                _queue[index]["st"] = status;
            }
        }
    }

    public static bool ValidFilename(string name)
    {
        if (string.IsNullOrEmpty(name) || name.Length > 240) return false;
        if (name.EndsWith(" ") || name.EndsWith(".")) return false;
        if (Regex.IsMatch(name, @"[<>:""/\\|?*\x00-\x1f]")) return false;
        if (Regex.IsMatch(name, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", RegexOptions.IgnoreCase)) return false;
        return true;
    }

    private static int? ExtractEpisodeNumber(string stem)
    {
        string cleaned = Regex.Replace(stem, @"\(\d+\)\s*$", "").Trim();
        Match m1 = Regex.Match(cleaned, @"第\s*(\d+)\s*集");
        if (m1.Success) return int.Parse(m1.Groups[1].Value, CultureInfo.InvariantCulture);
        Match m2 = Regex.Match(cleaned, @"(\d+)\s*集");
        if (m2.Success) return int.Parse(m2.Groups[1].Value, CultureInfo.InvariantCulture);
        MatchCollection all = Regex.Matches(cleaned, @"\d+");
        if (all.Count > 0) return int.Parse(all[all.Count - 1].Value, CultureInfo.InvariantCulture);
        return null;
    }

    private void ValidateRenamePlan(bool capture)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in _plan)
        {
            string src = Convert.ToString(item["source"]);
            string dst = Convert.ToString(item["target"]);
            FileInfo sInfo = new FileInfo(src);
            FileInfo dInfo = new FileInfo(dst);
            if (!sInfo.Exists || (sInfo.Attributes & FileAttributes.ReparsePoint) != 0)
            {
                throw new InvalidOperationException("文件路径已变化或超出所选目录，请重新预览。");
            }
            if (!ValidFilename(dInfo.Name) || !string.Equals(sInfo.DirectoryName, dInfo.DirectoryName, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("文件路径已变化或超出所选目录，请重新预览。");
            }
            if (!string.Equals(sInfo.Extension, dInfo.Extension, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("不允许改变扩展名。");
            }
            if (!seen.Add(dInfo.FullName))
            {
                throw new InvalidOperationException("多份文件被命名为同一名称，请修改模板。");
            }
            if (dInfo.Exists && !string.Equals(sInfo.FullName, dInfo.FullName, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("目标文件已经存在：" + dInfo.Name);
            }
            long[] fp = new long[] { sInfo.Length, sInfo.LastWriteTimeUtc.Ticks };
            if (capture)
            {
                item["fingerprint"] = fp;
            }
            else
            {
                var oldFp = item.ContainsKey("fingerprint") ? item["fingerprint"] as long[] : null;
                if (oldFp == null || oldFp.Length != 2 || oldFp[0] != fp[0] || oldFp[1] != fp[1])
                {
                    throw new InvalidOperationException("预览后源文件已变化，请重新预览。");
                }
            }
        }
    }

    private void RegexPreview(string folder, string template)
    {
        if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder))
        {
            throw new InvalidOperationException("请选择存在的目标文件夹。");
        }
        Match m = Regex.Match(template, @"\d+");
        if (!m.Success)
        {
            throw new InvalidOperationException("模板必须包含一个数字，例如：短剧名称_第1集");
        }
        string prefix = template.Substring(0, m.Index);
        string suffix = template.Substring(m.Index + m.Length);
        string[] exts = new[] { ".mp4", ".srt", ".mp3", ".wav", ".mkv" };

        var files = Directory.GetFiles(folder)
            .Select(f => new FileInfo(f))
            .Where(fi => exts.Contains(fi.Extension.ToLowerInvariant()))
            .OrderBy(fi => Regex.IsMatch(Path.GetFileNameWithoutExtension(fi.Name), @"\(\d+\)\s*$") ? 1 : 0)
            .ThenBy(fi => fi.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var plan = new List<Dictionary<string, object>>();
        var usedTargets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var fi in files)
        {
            string stem = Path.GetFileNameWithoutExtension(fi.Name);
            int? ep = ExtractEpisodeNumber(stem);
            if (!ep.HasValue) continue;
            string newName = prefix + ep.Value + suffix + fi.Extension;
            if (!usedTargets.Add(newName)) continue;
            plan.Add(new Dictionary<string, object>
            {
                { "source", fi.FullName },
                { "target", Path.Combine(fi.DirectoryName, newName) },
                { "old_name", fi.Name },
                { "new_name", newName },
                { "mode", "正则匹配" }
            });
        }
        _plan = plan;
        ValidateRenamePlan(true);
        Log(string.Format("已生成 {0} 个文件的改名预览。", _plan.Count));
    }

    private void FillAiRename(IList data)
    {
        if (data == null || data.Count > 2000) throw new InvalidOperationException("AI 改名方案无效。");
        var mapping = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (string f in _selectedFiles)
        {
            string baseName = Path.GetFileName(f);
            if (mapping.ContainsKey(baseName)) throw new InvalidOperationException("所选文件含同名文件，请分文件夹处理。");
            mapping[baseName] = f;
        }
        var plan = new List<Dictionary<string, object>>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (object itemObj in data)
        {
            var item = itemObj as IDictionary;
            if (item == null) throw new InvalidOperationException("AI 改名方案无效。");
            string oldName = item.Contains("old") ? Convert.ToString(item["old"]) : "";
            string newName = item.Contains("new") ? Convert.ToString(item["new"]) : "";
            if (string.IsNullOrEmpty(oldName) || !mapping.ContainsKey(oldName) || !seen.Add(oldName) || !ValidFilename(newName))
            {
                throw new InvalidOperationException("AI 返回未知、重复或不合法文件名。");
            }
            string source = mapping[oldName];
            if (!string.Equals(Path.GetExtension(source), Path.GetExtension(newName), StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("改名不能改变文件扩展名。");
            }
            plan.Add(new Dictionary<string, object>
            {
                { "source", source },
                { "target", Path.Combine(Path.GetDirectoryName(source), newName) },
                { "old_name", oldName },
                { "new_name", newName },
                { "mode", "AI重命名" }
            });
        }
        _plan = plan;
        ValidateRenamePlan(true);
        Log(string.Format("已生成 {0} 个文件的改名预览。", _plan.Count));
    }

    private void ExecuteRename()
    {
        ValidateRenamePlan(false);
        var done = new List<Dictionary<string, object>>();
        string journal = Path.Combine(_dataDir, "rename-" + Guid.NewGuid().ToString("N") + ".json");
        AtomicWriteJson(journal, new Dictionary<string, object> { { "state", "planned" }, { "files", _plan } });
        try
        {
            foreach (var item in _plan)
            {
                string src = Convert.ToString(item["source"]);
                string dst = Convert.ToString(item["target"]);
                if (string.Equals(src, dst, StringComparison.Ordinal)) continue;
                File.Move(src, dst);
                done.Add(item);
            }
            AtomicWriteJson(journal, new Dictionary<string, object> { { "state", "complete" }, { "files", done } });
        }
        catch
        {
            for (int i = done.Count - 1; i >= 0; i--)
            {
                try { File.Move(Convert.ToString(done[i]["target"]), Convert.ToString(done[i]["source"])); } catch { }
            }
            throw;
        }
        _plan.Clear();
        string msg = string.Format("已完成 {0} 个文件改名。", done.Count);
        Log(msg);
        _notice = msg;
    }

    private static string FormatSrtTime(long us)
    {
        long totalMs = us / 1000;
        long ms = totalMs % 1000;
        long totalSec = totalMs / 1000;
        long s = totalSec % 60;
        long totalMin = totalSec / 60;
        long m = totalMin % 60;
        long h = totalMin / 60;
        return string.Format(CultureInfo.InvariantCulture, "{0:D2}:{1:D2}:{2:D2},{3:D3}", h, m, s, ms);
    }

    private static Dictionary<string, IDictionary> GetSubtitleMaterials(IDictionary data)
    {
        var result = new Dictionary<string, IDictionary>(StringComparer.Ordinal);
        var materials = data["materials"] as IDictionary;
        if (materials == null || !materials.Contains("texts")) return result;
        var texts = materials["texts"] as IList;
        if (texts == null) return result;
        foreach (object tObj in texts)
        {
            var mat = tObj as IDictionary;
            if (mat == null || !mat.Contains("id")) continue;
            string id = Convert.ToString(mat["id"]);
            if (string.IsNullOrEmpty(id)) continue;
            string type = mat.Contains("type") ? Convert.ToString(mat["type"]).Trim().ToLowerInvariant() : "";
            string rec = mat.Contains("recognize_text") ? Convert.ToString(mat["recognize_text"]) : "";
            if (type == "subtitle" || !string.IsNullOrWhiteSpace(rec))
            {
                result[id] = mat;
            }
        }
        return result;
    }

    private static List<IDictionary> GetSubtitleTracks(IDictionary data)
    {
        var subMats = GetSubtitleMaterials(data);
        var tracks = new List<IDictionary>();
        if (subMats.Count == 0 || !data.Contains("tracks")) return tracks;
        var allTracks = data["tracks"] as IList;
        if (allTracks == null) return tracks;
        foreach (object trObj in allTracks)
        {
            var tr = trObj as IDictionary;
            if (tr == null || Convert.ToString(tr["type"]) != "text") continue;
            var segs = tr.Contains("segments") ? tr["segments"] as IList : null;
            if (segs == null) continue;
            bool hasSub = false;
            foreach (object sObj in segs)
            {
                var seg = sObj as IDictionary;
                if (seg != null && seg.Contains("material_id") && subMats.ContainsKey(Convert.ToString(seg["material_id"])))
                {
                    hasSub = true;
                    break;
                }
            }
            if (hasSub) tracks.Add(tr);
        }
        return tracks;
    }

    private List<string> ExtractSubtitleLines(IDictionary data)
    {
        var subMats = GetSubtitleMaterials(data);
        var segments = new List<IDictionary>();
        foreach (var tr in GetSubtitleTracks(data))
        {
            var segs = tr["segments"] as IList;
            if (segs != null)
            {
                foreach (object s in segs)
                {
                    if (s is IDictionary) segments.Add((IDictionary)s);
                }
            }
        }
        segments = segments.OrderBy(s =>
        {
            var tr = s.Contains("target_timerange") ? s["target_timerange"] as IDictionary : null;
            return tr != null && tr.Contains("start") ? Convert.ToInt64(tr["start"]) : 0L;
        }).ToList();

        var lines = new List<string>();
        foreach (var seg in segments)
        {
            string matId = seg.Contains("material_id") ? Convert.ToString(seg["material_id"]) : "";
            if (!subMats.ContainsKey(matId)) continue;
            var mat = subMats[matId];
            string text = "";
            if (mat.Contains("content"))
            {
                object contentObj = mat["content"];
                if (contentObj is string)
                {
                    try
                    {
                        var parsed = _json.DeserializeObject((string)contentObj) as IDictionary;
                        if (parsed != null && parsed.Contains("text")) text = Convert.ToString(parsed["text"]);
                    }
                    catch
                    {
                        text = (string)contentObj;
                    }
                }
                else if (contentObj is IDictionary)
                {
                    var cd = (IDictionary)contentObj;
                    if (cd.Contains("text")) text = Convert.ToString(cd["text"]);
                }
            }
            if (string.IsNullOrWhiteSpace(text) && mat.Contains("recognize_text")) text = Convert.ToString(mat["recognize_text"]);
            if (string.IsNullOrWhiteSpace(text) && mat.Contains("base_content")) text = Convert.ToString(mat["base_content"]);
            if (string.IsNullOrWhiteSpace(text)) continue;

            var timerange = seg.Contains("target_timerange") ? seg["target_timerange"] as IDictionary : null;
            long start = timerange != null && timerange.Contains("start") ? Convert.ToInt64(timerange["start"]) : 0L;
            long duration = timerange != null && timerange.Contains("duration") ? Convert.ToInt64(timerange["duration"]) : 0L;
            lines.Add(((lines.Count / 4) + 1).ToString(CultureInfo.InvariantCulture));
            lines.Add(FormatSrtTime(start) + " --> " + FormatSrtTime(start + duration));
            lines.Add(text.Trim());
            lines.Add("");
        }
        return lines;
    }

    private static int SetSubtitleTracksHidden(IDictionary data, bool hidden)
    {
        var tracks = GetSubtitleTracks(data);
        foreach (var tr in tracks)
        {
            var segs = tr["segments"] as IList;
            if (segs == null) continue;
            foreach (object sObj in segs)
            {
                var seg = sObj as IDictionary;
                if (seg != null) seg["visible"] = !hidden;
            }
        }
        return tracks.Count;
    }

    private List<Tuple<string, IDictionary>> FindSubtitleJsons(string draftDir)
    {
        var candidates = new List<string> { Path.Combine(draftDir, "draft_content.json") };
        string timelinesDir = Path.Combine(draftDir, "Timelines");
        if (Directory.Exists(timelinesDir))
        {
            foreach (string sub in Directory.GetDirectories(timelinesDir).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
            {
                candidates.Add(Path.Combine(sub, "draft_content.json"));
            }
        }
        var results = new List<Tuple<string, IDictionary>>();
        foreach (string file in candidates)
        {
            if (!File.Exists(file)) continue;
            try
            {
                IDictionary data = null;
                try { data = _json.DeserializeObject(File.ReadAllText(file, Encoding.UTF8)) as IDictionary; }
                catch (ArgumentException) { }
                if (data == null)
                {
                    int generation = _operationGeneration;
                    data = JianYingDraftIO.Request("read", file, null, () => CheckInterrupted(generation));
                    _encryptedDrafts.Add(file);
                }
                else _encryptedDrafts.Remove(file);
                if (data != null && GetSubtitleTracks(data).Count > 0)
                {
                    results.Add(Tuple.Create(file, data));
                }
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception error) { throw new InvalidOperationException("草稿副本未全部读取成功，未修改字幕轨道：" + file + "；" + error.Message); }
        }
        return results;
    }

    private void SaveSubtitleJsons(List<Tuple<string, IDictionary>> items, int gen)
    {
        string stamp = DateTime.Now.ToString("yyyyMMdd_HHmmss_fff", CultureInfo.InvariantCulture);
        var backups = new List<Tuple<string, string>>();
        try
        {
            foreach (var item in items)
            {
                CheckInterrupted(gen);
                string bak = item.Item1 + ".before_subtitle_" + stamp + ".bak";
                File.Copy(item.Item1, bak, true);
                backups.Add(Tuple.Create(item.Item1, bak));
            }
            foreach (var item in items)
            {
                CheckInterrupted(gen);
                IDictionary verified;
                if (_encryptedDrafts.Contains(item.Item1)) verified = JianYingDraftIO.Request("write", item.Item1, _json.Serialize(item.Item2), () => CheckInterrupted(gen));
                else { AtomicWriteJson(item.Item1, item.Item2); verified = _json.DeserializeObject(File.ReadAllText(item.Item1, Encoding.UTF8)) as IDictionary; }
                if (!SameJson(item.Item2, verified)) throw new InvalidOperationException("草稿写入后校验不一致，已回滚：" + item.Item1);
            }
        }
        catch
        {
            foreach (var b in backups)
            {
                if (File.Exists(b.Item2))
                {
                    try { File.Copy(b.Item2, b.Item1, true); } catch { }
                }
            }
            throw;
        }
    }

    private void RunExtractSubtitles(int gen)
    {
        if (IsJianyingRunning()) throw new InvalidOperationException("请先完全退出剪映，再提取并隐藏字幕。");
        if (string.IsNullOrEmpty(_draftDir) || !Directory.Exists(_draftDir)) throw new InvalidOperationException("草稿根目录不存在。");
        Directory.CreateDirectory(_subtitleOutput);
        int ok = 0;
        foreach (string subDir in Directory.GetDirectories(_draftDir))
        {
            CheckInterrupted(gen);
            string name = Path.GetFileName(subDir);
            if (string.Equals(name, "srt", StringComparison.OrdinalIgnoreCase)) continue;
            var jsons = FindSubtitleJsons(subDir);
            if (jsons.Count == 0) continue;
            var lines = ExtractSubtitleLines(jsons[0].Item2);
            if (lines.Count == 0) continue;
            string srtPath = Path.Combine(_subtitleOutput, name + ".srt");
            File.WriteAllText(srtPath, string.Join("\n", lines), new UTF8Encoding(false));
            foreach (var j in jsons) SetSubtitleTracksHidden(j.Item2, true);
            SaveSubtitleJsons(jsons, gen);
            ok++;
            Log("  ✓ " + name + " → " + Path.GetFileName(srtPath));
        }
        ShowNotice("提取完成", string.Format("共处理 {0} 个草稿", ok));
    }

    private static string FindNotoSansBold()
    {
        string[] dirs = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Windows", "Fonts"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Fonts")
        };
        foreach (string d in dirs)
        {
            if (!Directory.Exists(d)) continue;
            foreach (string f in Directory.GetFiles(d))
            {
                string ext = Path.GetExtension(f).ToLowerInvariant();
                if (ext != ".ttf" && ext != ".otf" && ext != ".ttc") continue;
                string clean = Regex.Replace(Path.GetFileName(f).ToLowerInvariant(), @"[^a-z0-9]", "");
                if (clean.Contains("notosansbold")) return f.Replace('\\', '/');
            }
        }
        return null;
    }

    private void RunFixFonts(int gen)
    {
        if (IsJianyingRunning()) throw new InvalidOperationException("请先完全退出剪映，再修改草稿字体。");
        string fontPath = FindNotoSansBold();
        if (string.IsNullOrEmpty(fontPath)) throw new InvalidOperationException("未在系统中找到 Noto Sans Bold 字体文件，请先安装该字体！");
        if (string.IsNullOrEmpty(_draftDir) || !Directory.Exists(_draftDir)) throw new InvalidOperationException("草稿根目录不存在。");
        var tplFont = new Dictionary<string, object> { { "path", fontPath }, { "id", "" } };
        int ok = 0;
        foreach (string subDir in Directory.GetDirectories(_draftDir))
        {
            CheckInterrupted(gen);
            var jsons = FindSubtitleJsons(subDir);
            if (jsons.Count == 0) continue;
            foreach (var j in jsons)
            {
                var mats = GetSubtitleMaterials(j.Item2);
                foreach (var mat in mats.Values)
                {
                    if (!mat.Contains("content")) continue;
                    bool wasString = mat["content"] is string;
                    IDictionary content = wasString
                        ? (_json.DeserializeObject((string)mat["content"]) as IDictionary)
                        : (mat["content"] as IDictionary);
                    if (content == null || !content.Contains("styles")) continue;
                    var styles = content["styles"] as IList;
                    if (styles == null) continue;
                    foreach (object stObj in styles)
                    {
                        var st = stObj as IDictionary;
                        if (st != null) st["font"] = tplFont;
                    }
                    mat["content"] = wasString ? (object)_json.Serialize(content) : (object)content;
                }
                SetSubtitleTracksHidden(j.Item2, false);
            }
            SaveSubtitleJsons(jsons, gen);
            ok++;
        }
        ShowNotice("处理完成", string.Format("成功统一 {0} 个草稿字体", ok));
    }

    private void RunUnhideTracks(int gen)
    {
        if (IsJianyingRunning()) throw new InvalidOperationException("请先完全退出剪映，再执行解除隐藏。");
        if (string.IsNullOrEmpty(_draftDir) || !Directory.Exists(_draftDir)) throw new InvalidOperationException("草稿根目录不存在。");
        int ok = 0;
        foreach (string subDir in Directory.GetDirectories(_draftDir))
        {
            CheckInterrupted(gen);
            var jsons = FindSubtitleJsons(subDir);
            if (jsons.Count == 0) continue;
            foreach (var j in jsons) SetSubtitleTracksHidden(j.Item2, false);
            SaveSubtitleJsons(jsons, gen);
            ok++;
        }
        ShowNotice("处理完成", string.Format("成功解除 {0} 个草稿的隐藏状态", ok));
    }

    public void Dispatch(string action, IDictionary args)
    {
        if (action == "scan_capture_ready" || action == "recording_capture_ready")
        {
            CaptureAck slot = action == "scan_capture_ready" ? _scanCapture : _recordingCapture;
            if (slot != null && slot.Id == Convert.ToString(args["id"]) &&
                (action == "scan_capture_ready" || slot.Token == Convert.ToString(args["token"])))
            {
                slot.Error = args.Contains("error") ? Convert.ToString(args["error"]) ?? "" : "";
                slot.Ready.Set();
            }
            return;
        }
        if (action == "ai_result")
        {
            string token = args.Contains("token") ? Convert.ToString(args["token"]) : "";
            AiRequestSlot slot = null;
            lock (_lock)
            {
                if (_aiRequests.ContainsKey(token)) slot = _aiRequests[token];
            }
            if (slot != null)
            {
                slot.Text = args.Contains("text") ? Convert.ToString(args["text"]) ?? "" : "";
                slot.Error = args.Contains("error") ? Convert.ToString(args["error"]) ?? "" : "";
                slot.Event.Set();
            }
            return;
        }
        if (action == "status") return;
        if (action == "stop")
        {
            StopOperation("中断按钮");
            return;
        }
        if (action == "modal")
        {
            Action cb = null;
            bool confirmed = args.Contains("confirmed") && Convert.ToBoolean(args["confirmed"]);
            lock (_lock)
            {
                string id = args.Contains("id") ? Convert.ToString(args["id"]) : "";
                if (_modal == null || Convert.ToString(_modal["id"]) != id)
                {
                    throw new InvalidOperationException("确认已失效。");
                }
                _modal = null;
                cb = _modalCallback;
                _modalCallback = null;
            }
            if (confirmed && cb != null) cb();
            return;
        }

        lock (_lock)
        {
            if (_busy || _exportActive || _modal != null)
            {
                throw new InvalidOperationException("请先完成、取消或中断当前任务。");
            }
            if (_recState != null)
            {
                throw new InvalidOperationException("请先完成或中断坐标录制。");
            }
        }

        switch (action)
        {
            case "scan":
                _webScan = args.Contains("webScan") && args["webScan"] is bool && (bool)args["webScan"];
                BeginOperation(RunScopedScan);
                break;

            case "wizard":
                lock (_lock)
                {
                    var next = NextCoordinateTemplateIdentity();
                    _recordingCoords = new Dictionary<string, int[]>
                    {
                        { "export", null },
                        { "confirm", null },
                        { "popup_close", null },
                        { "close_btn", null },
                        { "draft_close", null }
                    };
                    _recordingColor = null;
                    _recordingTemplateName = next.Item1;
                    _recordingTemplatePath = next.Item2;
                    _recState = "export";
                    string firstStep = _exportMode == "wait_close" ? "[1/4]" : "[1/3]";
                    _guide = firstStep + " 鼠标放在【导出】上 → 按 F8";
                    Log("向导开始，完成后将保存为本地坐标模板【" + next.Item1 + "】");
                }
                BeginRecordingProgress();
                break;

            case "export":
                {
                    int idx = args.Contains("index") ? Convert.ToInt32(args["index"]) : 0;
                    if (_resolutionMismatch) throw new InvalidOperationException("显示分辨率与模板不同，请重新录制坐标。");
                    if (!ModeCoordsReady()) throw new InvalidOperationException("请先录制完整坐标。");
                    if (_drafts.Count == 0) throw new InvalidOperationException("请先 AI 扫描首页。");
                    ValidateDraftQueue();
                    if (idx < 0 || idx >= _drafts.Count) idx = 0;
                    string nm = _drafts[idx].Item3;
                    int count = _drafts.Count - idx;
                    string modeName = _exportMode == "return_home" ? "收起至首页" : "等待完成关闭";
                    AskYesNo(
                        "确认开始",
                        string.Format("模式：【{0}】\n将从【{1}】(第{2}个) 开始\n共 {3} 个待导出，确认？", modeName, nm, idx + 1, count),
                        () =>
                        {
                            ValidateDraftQueue();
                            Send(new Dictionary<string, object> { { "event", "minimize" } });
                            BeginOperation(gen => RunExportLoop(idx, _exportMode, gen));
                        }
                    );
                }
                break;

            case "extract":
                AskYesNo("安全确认", "确定执行？此操作将提取 SRT 并隐藏字幕轨道", () => BeginOperation(RunExtractSubtitles));
                break;

            case "fonts":
                if (IsJianyingRunning()) throw new InvalidOperationException("请先完全退出剪映，再修改草稿字体。");
                AskYesNo("安全确认", "确定执行？此操作将统一字体并解除隐藏", () => BeginOperation(RunFixFonts));
                break;

            case "unhide":
                AskYesNo("安全确认", "确定执行？此操作将解除所有草稿的字幕隐藏", () => BeginOperation(RunUnhideTracks));
                break;

            case "paths":
                if (args.Contains("draftDir"))
                {
                    string val = Convert.ToString(args["draftDir"]);
                    if (!Path.IsPathRooted(val) || !Directory.Exists(val)) throw new InvalidOperationException("请选择存在的本地文件夹。");
                    _draftDir = Path.GetFullPath(val);
                }
                if (args.Contains("subtitleOutput"))
                {
                    string val = Convert.ToString(args["subtitleOutput"]);
                    if (!Path.IsPathRooted(val) || !Directory.Exists(val)) throw new InvalidOperationException("请选择存在的本地文件夹。");
                    _subtitleOutput = Path.GetFullPath(val);
                }
                SaveConfig();
                break;

            case "files":
                {
                    var list = args.Contains("files") ? args["files"] as IList : null;
                    if (list == null || list.Count > 2000) throw new InvalidOperationException("文件列表无效。");
                    var valid = new List<string>();
                    foreach (object fObj in list)
                    {
                        string f = Convert.ToString(fObj);
                        if (string.IsNullOrEmpty(f) || !Path.IsPathRooted(f) || !File.Exists(f))
                        {
                            throw new InvalidOperationException("文件列表无效。");
                        }
                        valid.Add(Path.GetFullPath(f));
                    }
                    _selectedFiles = valid;
                    _plan.Clear();
                }
                break;

            case "preview":
                {
                    string folder = args.Contains("folder") ? Convert.ToString(args["folder"]) ?? "" : "";
                    string template = args.Contains("template") ? Convert.ToString(args["template"]) ?? "" : "";
                    bool ai = args.Contains("ai") && Convert.ToBoolean(args["ai"]);
                    if (string.IsNullOrEmpty(template) || template.Length > 500)
                    {
                        throw new InvalidOperationException("请输入最多 500 字符的命名模板。");
                    }
                    if (ai)
                    {
                        if (!string.IsNullOrEmpty(folder))
                        {
                            if (!Path.IsPathRooted(folder) || !Directory.Exists(folder)) throw new InvalidOperationException("请选择存在的文件夹。");
                            string[] exts = new[] { ".mp4", ".srt", ".mp3", ".wav", ".mkv" };
                            _selectedFiles = Directory.GetFiles(folder)
                                .Where(f => exts.Contains(Path.GetExtension(f).ToLowerInvariant()))
                                .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                                .ToList();
                        }
                        if (_selectedFiles.Count == 0) throw new InvalidOperationException("请先选择需要改名的文件。");
                        BeginOperation(gen =>
                        {
                            var fns = _selectedFiles.Select(Path.GetFileName).ToList();
                            string prompt = string.Format("Rename these files to: {0}\nFiles: {1}\nReturn ONLY raw JSON array with 'old' and 'new' keys.", template, _json.Serialize(fns));
                            string resp = RequestAiText(prompt, null, gen);
                            string cleaned = Regex.Replace(resp.Trim(), @"^```(?:json)?\s*|\s*```$", "", RegexOptions.Singleline);
                            var arr = _json.DeserializeObject(cleaned) as IList;
                            FillAiRename(arr);
                        });
                    }
                    else
                    {
                        RegexPreview(folder, template);
                    }
                }
                break;

            case "rename":
                ExecuteRename();
                break;

            case "settings":
                if (args.Contains("mode"))
                {
                    string mode = Convert.ToString(args["mode"]);
                    if (mode != "return_home" && mode != "wait_close") throw new InvalidOperationException("无法保存导出模式。");
                    _exportMode = mode;
                }
                if (args.Contains("waits"))
                {
                    var w = args["waits"] as IDictionary;
                    if (w == null) throw new InvalidOperationException("等待时间应为 0.1–600 秒。");
                    foreach (var key in _stepWaits.Keys.ToList())
                    {
                        if (w.Contains(key))
                        {
                            double val;
                            if (!double.TryParse(Convert.ToString(w[key], CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out val)
                                || double.IsNaN(val) || double.IsInfinity(val) || val < 0.1 || val > 600.0)
                            {
                                throw new InvalidOperationException("等待时间应为 0.1–600 秒。");
                            }
                            _stepWaits[key] = Math.Round(val, 1);
                        }
                    }
                }
                SaveConfig();
                RefreshGuideBadge();
                break;

            case "select_template":
                {
                    string id = Path.GetFileName(Convert.ToString(args["id"] ?? ""));
                    string path = Path.Combine(_dataDir, id);
                    if (!LoadCoordinateTemplate(path)) throw new InvalidOperationException("坐标模板不存在或格式无效。");
                    SaveConfig();
                }
                break;

            case "rename_template":
                {
                    string id = Path.GetFileName(Convert.ToString(args["id"] ?? ""));
                    string newName = Convert.ToString(args["name"] ?? "").Trim();
                    if (string.IsNullOrEmpty(newName) || newName.Length > 40) throw new InvalidOperationException("请输入有效的模板名称。");
                    string path = Path.Combine(_dataDir, id);
                    var rec = ReadCoordinateTemplateRecord(path);
                    if (rec == null) throw new InvalidOperationException("模板不存在。");
                    var data = (Dictionary<string, object>)rec["data"];
                    data["template_name"] = newName;
                    AtomicWriteJson(path, data);
                    if (string.Equals(_activeTemplatePath, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase))
                    {
                        _activeTemplateName = newName;
                    }
                    RefreshGuideBadge();
                    ShowNotice("模板已改名", newName);
                }
                break;

            case "delete_template":
                {
                    string id = Path.GetFileName(Convert.ToString(args["id"] ?? ""));
                    string path = Path.Combine(_dataDir, id);
                    var rec = ReadCoordinateTemplateRecord(path);
                    if (rec == null) throw new InvalidOperationException("模板不存在。");
                    string tName = Convert.ToString(rec["name"]);
                    AskYesNo("删除坐标模板", "确定要删除模板【" + tName + "】吗？", () =>
                    {
                        Directory.CreateDirectory(_deletedTemplateDir);
                        string dest = Path.Combine(_deletedTemplateDir, Path.GetFileNameWithoutExtension(path) + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".json");
                        if (File.Exists(dest)) File.Delete(dest);
                        File.Move(path, dest);
                        var remaining = GetCoordinateTemplateRecords();
                        if (remaining.Count > 0)
                        {
                            LoadCoordinateTemplate(Convert.ToString(remaining[0]["path"]));
                        }
                        else
                        {
                            _activeTemplateName = null;
                            _activeTemplatePath = "";
                            foreach (var k in _coords.Keys.ToList()) _coords[k] = null;
                        }
                        SaveConfig();
                        RefreshGuideBadge();
                        ShowNotice("模板已删除", tName);
                    });
                }
                break;

            default:
                throw new InvalidOperationException("不支持的操作。");
        }
    }

    public void Close()
    {
        _disposed = true;
        StopOperation("退出工具");
        // Let cancellation kill child DraftIO calls and finish file rollback before exit.
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed.TotalSeconds < 10)
        {
            lock (_lock) { if (!_busy && _recordingCapture == null) break; }
            Thread.Sleep(20);
        }
    }
}

internal static class Program
{
    public static int Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        NativeWin32.SetProcessDPIAware();

        if (args.Length == 3 && args[0] == "--draft-io") return JianYingDraftIO.Worker(args[1], args[2]);

        var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        if (args.Length == 1 && args[0] == "--verify-runtime")
        {
            Console.Out.WriteLine(json.Serialize(new Dictionary<string, object>
            {
                { "ok", true },
                { "opencv", "native-gdi" },
                { "pillow", "native-gdi" },
                { "operationsStarted", false }
            }));
            Console.Out.Flush();
            return 0;
        }

        if (args.Length != 2 || args[0] != "--data-dir")
        {
            Console.Error.WriteLine("需要独立数据目录。");
            return 1;
        }

        var engine = new JianYingEngine(args[1]);
        try
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                object reqId = null;
                try
                {
                    if (line.Length > 2000000) throw new InvalidOperationException("请求过大。");
                    var req = json.Deserialize<Dictionary<string, object>>(line);
                    if (req != null && req.ContainsKey("id")) reqId = req["id"];
                    string action = req != null && req.ContainsKey("action") ? Convert.ToString(req["action"]) : "";
                    if (action == "shutdown")
                    {
                        engine.Close();
                        engine.Send(new Dictionary<string, object> { { "id", reqId }, { "state", engine.Snapshot() } });
                        return 0;
                    }
                    IDictionary actionArgs = (req != null && req.ContainsKey("args") && req["args"] is IDictionary)
                        ? (IDictionary)req["args"]
                        : new Dictionary<string, object>();
                    engine.Dispatch(action, actionArgs);
                    engine.Send(new Dictionary<string, object> { { "id", reqId }, { "state", engine.Snapshot() } });
                }
                catch (Exception ex)
                {
                    string msg = ex.Message ?? "操作失败";
                    if (msg.Length > 500) msg = msg.Substring(0, 500);
                    engine.Send(new Dictionary<string, object> { { "id", reqId }, { "error", msg } });
                }
            }
        }
        finally
        {
            engine.Close();
        }
        return 0;
    }
}
