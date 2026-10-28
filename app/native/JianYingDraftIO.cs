using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32;

// Adapted from the existing Python DraftIO bridge. Undocumented C++ ABI calls
// run in a short-lived child so failures and native allocations stay isolated.
internal sealed class JianYingDraftIO
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string name, IntPtr file, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern IntPtr GetProcAddress(IntPtr module, string name);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr Constructor(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr Call2(IntPtr self, IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr Call3(IntPtr self, IntPtr result, IntPtr value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr Call4(IntPtr self, IntPtr result, IntPtr key, IntPtr value);
    private const string CtorName = "??0DraftIOFactoryBase@draft_store@@QEAA@XZ";
    private const string CreateName = "?createIO@DraftIOFactoryBase@draft_store@@UEAA?AV?$shared_ptr@UIDraftIO@draft_store@@@std@@PEBV?$array@D$0CA@@4@AEBV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@4@@Z";
    private const string EntropyName = "?calcEntropyDynamicString@DraftIOFactoryBase@draft_store@@UEAA?AU?$pair@V?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@V?$array@D$0CA@@2@@std@@AEBV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@4@@Z";
    private readonly IntPtr module, factory;
    private readonly string version;
    private readonly List<IntPtr> owned = new List<IntPtr>();
    private IntPtr Allocate(int size) { var p = Marshal.AllocHGlobal(size); Marshal.Copy(new byte[size], 0, p, size); owned.Add(p); return p; }
    private T Export<T>(string name) { var p = GetProcAddress(module, name); if (p == IntPtr.Zero) throw new InvalidOperationException("当前剪映缺少草稿接口，请使用兼容的剪映版本。"); return (T)(object)Marshal.GetDelegateForFunctionPointer(p, typeof(T)); }
    private static T Virtual<T>(IntPtr instance, int index) { var p = Marshal.ReadIntPtr(Marshal.ReadIntPtr(instance), index * 8); return (T)(object)Marshal.GetDelegateForFunctionPointer(p, typeof(T)); }
    private IntPtr StringValue(string value) {
        byte[] bytes = Encoding.UTF8.GetBytes(value); IntPtr str = Allocate(32);
        if (bytes.Length < 16) Marshal.Copy(bytes, 0, str, bytes.Length);
        else { IntPtr buffer = Allocate(bytes.Length + 1); Marshal.Copy(bytes, 0, buffer, bytes.Length); Marshal.WriteIntPtr(str, buffer); }
        Marshal.WriteInt64(str, 16, bytes.Length); Marshal.WriteInt64(str, 24, Math.Max(15, bytes.Length)); return str;
    }
    private static string ReadString(IntPtr value) {
        long size = Marshal.ReadInt64(value, 16), capacity = Marshal.ReadInt64(value, 24);
        if (size < 0 || size > 256 * 1024 * 1024 || capacity < size) throw new InvalidOperationException("剪映接口返回了异常的数据长度。");
        IntPtr ptr = capacity < 16 ? value : Marshal.ReadIntPtr(value);
        if (ptr == IntPtr.Zero && size > 0) throw new InvalidOperationException("剪映接口返回空指针。");
        byte[] bytes = new byte[(int)size]; if (size > 0) Marshal.Copy(ptr, bytes, 0, bytes.Length);
        return Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF');
    }
    private JianYingDraftIO(string dll) {
        version = new DirectoryInfo(Path.GetDirectoryName(dll)).Name;
        module = LoadLibraryEx(dll, IntPtr.Zero, 0x1100); // DLL's own directory + safe system search paths
        if (module == IntPtr.Zero) throw new InvalidOperationException("无法载入剪映草稿接口，系统错误 " + Marshal.GetLastWin32Error());
        factory = Allocate(24); Export<Constructor>(CtorName)(factory);
    }
    private IntPtr Open(string path) {
        string attachment = null; DirectoryInfo dir = new FileInfo(path).Directory;
        for (int i = 0; i < 5 && dir != null; i++, dir = dir.Parent) {
            string candidate = Path.Combine(dir.FullName, "attachment_pc_common.json");
            if (File.Exists(candidate)) { attachment = candidate; break; }
        }
        if (attachment == null) throw new InvalidOperationException("找不到草稿 attachment_pc_common.json，请保留完整草稿文件夹。");
        IntPtr entropy = Allocate(64);
        Export<Call3>(EntropyName)(factory, entropy, StringValue(File.ReadAllText(attachment, Encoding.UTF8)));
        byte[] key = new byte[32]; Marshal.Copy(IntPtr.Add(entropy, 32), key, 0, 32);
        if (!key.Any(b => b != 0)) throw new InvalidOperationException("无法计算草稿密钥。");
        IntPtr shared = Allocate(16);
        Export<Call4>(CreateName)(factory, shared, IntPtr.Add(entropy, 32), StringValue(Path.GetFullPath(path)));
        IntPtr instance = Marshal.ReadIntPtr(shared);
        if (instance == IntPtr.Zero) throw new InvalidOperationException("无法打开剪映草稿。"); return instance;
    }
    private string Read(string path) {
        IntPtr instance = Open(path), result = Allocate(88);
        Virtual<Call2>(instance, 3)(instance, result);
        int code = Marshal.ReadInt32(result, 72);
        if (code != 0) throw new InvalidOperationException("剪映接口无法读取加密草稿（错误 " + code + "，接口版本 " + version + "）。" + (code == 6 ? "版本或草稿密钥可能不兼容，不能据此判断草稿损坏。" : "") + ReadString(IntPtr.Add(result, 40)));
        return ReadString(IntPtr.Add(result, 8));
    }
    private void Write(string path, string json) {
        IntPtr instance = Open(path), result = Allocate(48);
        Virtual<Call3>(instance, 7)(instance, result, StringValue(json));
        int code = Marshal.ReadInt32(result, 32);
        if (code != 0) throw new InvalidOperationException("剪映加密草稿写入失败（" + code + "）：" + ReadString(result));
    }
    private static void AddRoot(List<string> roots, string raw) {
        if (string.IsNullOrWhiteSpace(raw)) return;
        string value = Environment.ExpandEnvironmentVariables(raw.Trim());
        var quoted = Regex.Match(value, "^\"([^\"]+)\"");
        if (quoted.Success) value = quoted.Groups[1].Value;
        else { int exe = value.IndexOf(".exe", StringComparison.OrdinalIgnoreCase); if (exe >= 0) value = value.Substring(0, exe + 4); }
        value = value.Split(',')[0].Trim(' ', '"');
        if (File.Exists(value)) value = Path.GetDirectoryName(value);
        if (Directory.Exists(value)) roots.Add(Path.GetFullPath(value));
    }
    internal static string FindLibrary() {
        var roots = new List<string>();
        string configured = Environment.ExpandEnvironmentVariables(Environment.GetEnvironmentVariable("JIANYING_VIDEOEDITOR_DLL") ?? "").Trim(' ', '"');
        if (File.Exists(configured)) return Path.GetFullPath(configured); AddRoot(roots, configured);
        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine }) foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 }) {
            using (var baseKey = RegistryKey.OpenBaseKey(hive, view)) {
                foreach (var name in new[] { @"Software\Bytedance\JianyingPro", @"Software\Microsoft\Windows\CurrentVersion\App Paths\JianyingPro.exe" }) {
                    using (var key = baseKey.OpenSubKey(name)) if (key != null) foreach (var v in new[] { "installDir", "InstallLocation", "DisplayIcon", "Path", "" }) AddRoot(roots, key.GetValue(v) as string);
                }
                using (var uninstall = baseKey.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall")) if (uninstall != null) foreach (var name in uninstall.GetSubKeyNames()) {
                    using (var key = uninstall.OpenSubKey(name)) if (key != null && Regex.IsMatch(Convert.ToString(key.GetValue("DisplayName")), "jianying|剪映", RegexOptions.IgnoreCase)) foreach (var v in new[] { "InstallLocation", "DisplayIcon", "UninstallString" }) AddRoot(roots, key.GetValue(v) as string);
                }
            }
        }
        foreach (var folder in new[] { Environment.SpecialFolder.UserProfile, Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolder.ApplicationData, Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 }) {
            string root = Environment.GetFolderPath(folder);
            foreach (var relative in new[] { "JianyingPro", @"Programs\JianyingPro", @"ByteDance\JianyingPro" }) AddRoot(roots, Path.Combine(root, relative));
        }
        foreach (var drive in DriveInfo.GetDrives().Where(d => d.IsReady && d.DriveType == DriveType.Fixed)) foreach (var relative in new[] { "JianyingPro", @"Program Files\JianyingPro", @"Program Files (x86)\JianyingPro", @"Program Files\ByteDance\JianyingPro" }) AddRoot(roots, Path.Combine(drive.RootDirectory.FullName, relative));
        var files = new List<string>();
        foreach (var root in roots.Distinct(StringComparer.OrdinalIgnoreCase)) {
            var stack = new Stack<Tuple<string, int>>(); stack.Push(Tuple.Create(root, 0));
            while (stack.Count > 0) {
                var item = stack.Pop(); string file = Path.Combine(item.Item1, "videoeditor.dll"); if (File.Exists(file)) files.Add(file);
                if (item.Item2 >= 3) continue;
                try { foreach (var dir in Directory.GetDirectories(item.Item1)) if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) == 0) stack.Push(Tuple.Create(dir, item.Item2 + 1)); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
        }
        var found = files.OrderByDescending(f => Regex.Replace(new DirectoryInfo(Path.GetDirectoryName(f)).Name, @"\d+", m => m.Value.PadLeft(8, '0')), StringComparer.Ordinal).FirstOrDefault();
        if (found == null) throw new FileNotFoundException("未找到剪映 videoeditor.dll，请安装剪映或设置 JIANYING_VIDEOEDITOR_DLL。"); return found;
    }
    internal static int Worker(string mode, string path) {
        var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        try {
            if (mode != "read" && mode != "write") throw new InvalidOperationException("无效草稿操作。");
            var io = new JianYingDraftIO(FindLibrary());
            if (mode == "write") {
                string input = Console.In.ReadToEnd();
                if (!(json.DeserializeObject(input) is IDictionary)) throw new InvalidOperationException("草稿根节点必须为对象。");
                io.Write(path, input);
            }
            string text = io.Read(path);
            var data = json.DeserializeObject(text);
            if (!(data is IDictionary)) throw new InvalidOperationException("草稿根节点必须为对象。");
            Console.Out.WriteLine(json.Serialize(new { data = data })); return 0;
        } catch (Exception ex) { Console.Out.WriteLine(json.Serialize(new { error = ex.Message })); return 1; }
    }
    internal static IDictionary Request(string mode, string path, string input, Action check) {
        var start = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "--draft-io " + mode + " \"" + Path.GetFullPath(path) + "\"") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        using (var process = Process.Start(start)) {
            try {
                var output = process.StandardOutput.ReadToEndAsync(); var error = process.StandardError.ReadToEndAsync();
                var write = Task.Run(() => { if (input != null) { byte[] bytes = Encoding.UTF8.GetBytes(input); process.StandardInput.BaseStream.Write(bytes, 0, bytes.Length); process.StandardInput.BaseStream.Flush(); } process.StandardInput.Close(); });
                var watch = Stopwatch.StartNew();
                while (!process.WaitForExit(50)) { check(); if (watch.Elapsed.TotalSeconds > 45) throw new TimeoutException("剪映草稿接口响应超时，已停止处理。"); }
                try { write.GetAwaiter().GetResult(); } catch (IOException) { /* The worker may have already reported a library error. */ }
                string text = output.GetAwaiter().GetResult().Trim();
                // Ignore any diagnostic output produced by the third-party DLL.
                text = text.Split('\n').LastOrDefault(l => l.TrimStart().StartsWith("{\"data\":") || l.TrimStart().StartsWith("{\"error\":")) ?? "";
                if (text.Length == 0) throw new InvalidOperationException("剪映草稿接口异常退出（" + process.ExitCode + "），原草稿已保留。");
                var response = new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.DeserializeObject(text) as IDictionary;
                if (response.Contains("error")) throw new InvalidOperationException(Convert.ToString(response["error"]));
                return response["data"] as IDictionary;
            } finally { if (!process.HasExited) { process.Kill(); process.WaitForExit(5000); } }
        }
    }
}

internal sealed partial class JianYingEngine
{
    private static bool SameJson(object left, object right)
    {
        if (left == null || right == null) return left == right;
        var a = left as IDictionary; var b = right as IDictionary;
        if (a != null || b != null) {
            if (a == null || b == null || a.Count != b.Count) return false;
            foreach (DictionaryEntry pair in a) if (!b.Contains(pair.Key) || !SameJson(pair.Value, b[pair.Key])) return false;
            return true;
        }
        var la = left as IList; var lb = right as IList;
        if (la != null || lb != null) {
            if (la == null || lb == null || la.Count != lb.Count) return false;
            for (int i = 0; i < la.Count; i++) if (!SameJson(la[i], lb[i])) return false;
            return true;
        }
        if (left is string || right is string || left is bool || right is bool) return left.Equals(right);
        return Convert.ToDouble(left) == Convert.ToDouble(right);
    }
}
