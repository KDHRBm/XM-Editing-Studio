using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

namespace XM.Native {
    internal static class J {
        public static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024, RecursionLimit = 160 }; }
        public static string Encode(object value) { return Serializer().Serialize(value); }
        public static object Decode(string value) { return Serializer().DeserializeObject(value); }
        public static Dictionary<string, object> Map(object value) { return value as Dictionary<string, object> ?? new Dictionary<string, object>(); }
        public static Dictionary<string, object> Obj(params object[] pairs) { var d = new Dictionary<string, object>(); for (int i = 0; i < pairs.Length; i += 2) d[(string)pairs[i]] = pairs[i + 1]; return d; }
        public static object Get(object value, string key, object fallback = null) { object result; return Map(value).TryGetValue(key, out result) ? result : fallback; }
        public static string Str(object value, string key, string fallback = "") { return Convert.ToString(Get(value, key, fallback)); }
        public static bool Bool(object value, string key) { return Equals(Get(value, key), true); }
        public static double Num(object value, string key, double fallback = 0) { double result; return double.TryParse(Str(value, key), out result) ? result : fallback; }
        public static object[] Arr(object value) { var list = value as IEnumerable; return list != null && !(value is string) && !(value is IDictionary) ? list.Cast<object>().ToArray() : new object[0]; }
        public static object Read(string path, object fallback) { if (!File.Exists(path)) return fallback; return Decode(File.ReadAllText(path, Encoding.UTF8)); }
        public static void Save(string path, object value) {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temp, Encode(value), new UTF8Encoding(false));
            try { if (File.Exists(path)) File.Replace(temp, path, path + ".bak"); else File.Move(temp, path); }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        public static string Hash(byte[] bytes) { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
        public static string Hash(string text) { return Hash(Encoding.UTF8.GetBytes(text)); }
        public static string FileHash(string path) { using (var stream = File.OpenRead(path)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
        public static long Now() { return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; }
        public static string Under(string root, string relative) {
            root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var full = Path.GetFullPath(Path.Combine(root, relative));
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new Exception("文件路径超出允许范围。");
            return full;
        }
        public static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"").TrimEnd('\\') + "\""; }
    }
    // One worker per native engine; no socket server and no Node runtime.
    internal sealed class Engine : IDisposable {
        private readonly string exe, arguments;
        private Process process;
        private StreamWriter input;
        private int sequence;
        private bool disposed;
        private readonly object gate = new object();
        private readonly ConcurrentDictionary<int, TaskCompletionSource<object>> pending = new ConcurrentDictionary<int, TaskCompletionSource<object>>();
        public Action<Dictionary<string, object>> Event;
        public Engine(string executable, string args, string expectedHash = "") {
            exe = executable; arguments = args;
            if (!File.Exists(exe)) throw new FileNotFoundException("缺少原生引擎。", exe);
            if (expectedHash.Length > 0 && !string.Equals(J.FileHash(exe), expectedHash, StringComparison.OrdinalIgnoreCase)) throw new Exception("原生引擎完整性校验失败。");
        }
        private void Start() {
            if (disposed) throw new ObjectDisposedException("Engine");
            if (process != null && !process.HasExited) return;
            var info = new ProcessStartInfo(exe, arguments) { WorkingDirectory = Path.GetDirectoryName(exe), UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardInput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
            var own = Process.Start(info); process = own;
            // .NET Framework has no StandardInputEncoding. Its default writer uses
            // the Windows console code page, while all workers read UTF-8.
            input = new StreamWriter(own.StandardInput.BaseStream, new UTF8Encoding(false)) { AutoFlush = true };
            Task.Run(async () => {
                try {
                    string line;
                    while ((line = await own.StandardOutput.ReadLineAsync()) != null) {
                        Dictionary<string, object> message; try { message = J.Map(J.Decode(line)); } catch { continue; }
                        if (process != own) break;
                        if (message.ContainsKey("event")) { var receive = Event; if (receive != null) receive(message); continue; }
                        if (!message.ContainsKey("id") && J.Str(message, "error").Length > 0) { Fail(J.Str(message, "error")); continue; }
                        int id = (int)J.Num(message, "id"); TaskCompletionSource<object> waiter;
                        if (!pending.TryRemove(id, out waiter)) continue;
                        string error = J.Str(message, "error");
                        if (error.Length > 0) waiter.TrySetException(new Exception(error));
                        else waiter.TrySetResult(J.Get(message, "state", message));
                    }
                } catch (Exception error) { if (process == own) Fail(error.Message); }
                finally { if (process == own) Fail("原生引擎已退出，请重试。"); }
            });
            Task.Run(async () => { try { while (await own.StandardError.ReadLineAsync() != null) {} } catch {} });
        }
        private void Fail(string message) { foreach (var item in pending) { TaskCompletionSource<object> waiter; if (pending.TryRemove(item.Key, out waiter)) waiter.TrySetException(new Exception(message)); } }
        public async Task<object> Call(string action, object args = null, bool period = false, int timeout = 30000, bool flatten = false) {
            int id; TaskCompletionSource<object> waiter;
            lock (gate) {
                Start(); id = ++sequence; waiter = new TaskCompletionSource<object>(); pending[id] = waiter;
                try { var payload = period ? J.Obj("id", id, "command", action) : J.Obj("id", id, "action", action, "args", args ?? J.Obj()); if (flatten) { payload.Remove("args"); foreach (var item in J.Map(args)) payload[item.Key] = item.Value; } input.WriteLine(J.Encode(payload)); }
                catch { TaskCompletionSource<object> removed; pending.TryRemove(id, out removed); throw; }
            }
            if (await Task.WhenAny(waiter.Task, Task.Delay(timeout)) != waiter.Task) { TaskCompletionSource<object> removed; pending.TryRemove(id, out removed); throw new TimeoutException("原生引擎响应超时。"); }
            return await waiter.Task;
        }
        public void Dispose() { lock (gate) { disposed = true; if (process != null && !process.HasExited) { try { if (input != null) input.Close(); if (!process.WaitForExit(1800)) process.Kill(); } catch {} } Fail("程序正在退出。"); } }
    }
}
