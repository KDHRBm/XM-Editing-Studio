using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Threading.Tasks;
using System.Diagnostics;
using Microsoft.Win32;
[assembly: System.Reflection.AssemblyTitle("XM剪辑台 1.3.0 全量更新")]
[assembly: System.Reflection.AssemblyProduct("XM剪辑台")]
[assembly: System.Reflection.AssemblyVersion("1.3.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.3.0.0")]

public class PayloadFile { public string name, hash; public long bytes; }
public class FullManifest { public string product, version; public PayloadFile[] files; }
public class SavedFile { public string name, source, beforeHash, afterHash; public bool existed; }
public class FullBackup { public string target, version, previousVersion, state; public SavedFile[] files; }
static class FullUpdater {
  const string Version = "1.3.0";
  static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
  static readonly string[] Executables = { "小马剪辑台.exe", "XM剪辑台.exe", "黑曜信号台.exe" };
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
  static int FailAfter;
  static void Need(bool ok, string message) { if (!ok) throw new IOException(message); }
  static string Hash(string file) { using (var sha = SHA256.Create()) using (var stream = File.OpenRead(file)) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
  static string Child(string root, string name) {
    Need(!Path.IsPathRooted(name) && !name.Contains(":"), "清单路径无效。");
    string file = Path.GetFullPath(Path.Combine(root, name));
    Need(file.StartsWith(Path.GetFullPath(root).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase), "清单路径超出程序目录。");
    return file;
  }
  static void Normal(string file) {
    string at = Path.GetFullPath(file);
    while (!string.IsNullOrEmpty(at)) {
      if (File.Exists(at) || Directory.Exists(at)) Need((File.GetAttributes(at) & FileAttributes.ReparsePoint) == 0, "更新路径不能包含目录联接或符号链接：" + at);
      at = Path.GetDirectoryName(at);
    }
  }
  static bool EqualPath(string a, string b) { return string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase); }
  static void Verify(string file, string hash) { Normal(file); Need(File.Exists(file) && Hash(file) == hash, "文件校验失败：" + file); }
  static void Closed(string target, IEnumerable<string> names) {
    foreach (var process in Process.GetProcesses()) using (process) {
      string executable = null;
      try { executable = process.MainModule.FileName; } catch { }
      Need(executable == null || !executable.StartsWith(target + "\\", StringComparison.OrdinalIgnoreCase), "请先保存任务并完全退出剪辑台，再执行更新。检测到程序仍在运行。");
    }
    foreach (string name in names.Distinct(StringComparer.OrdinalIgnoreCase)) {
      string file = Child(target, name); Normal(file);
      Need(!Directory.Exists(file), "更新目标被同名文件夹占用：" + file);
      if (!File.Exists(file)) continue;
      try { using (var stream = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) {} }
      catch (IOException) { throw new IOException("程序文件正在使用，请退出剪辑台后重试：" + name); }
    }
  }
  static FullManifest Manifest() {
    Verify(Child(Root, "manifest.json"), FullManifestHash.Value);
    var manifest = Json.Deserialize<FullManifest>(File.ReadAllText(Child(Root, "manifest.json"), Encoding.UTF8));
    Need(manifest != null && manifest.version == Version && manifest.product == "XM剪辑台" && manifest.files != null && manifest.files.Length > 10, "更新清单无效。");
    var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var file in manifest.files) {
      Need(file != null && file.bytes > 0 && names.Add(file.name) && !file.name.StartsWith(".") && !file.name.Contains(".."), "更新文件清单无效。");
      string payload = Child(Child(Root, "payload"), file.name);
      Verify(payload, file.hash); Need(new FileInfo(payload).Length == file.bytes, "更新数据大小不匹配。");
    }
    Need(names.Contains("小马剪辑台.exe") && names.Contains("resources\\app.asar") && names.Contains("resources\\helpers\\PeriodKeeper.exe"), "全量更新缺少必要文件。");
    return manifest;
  }
  static string Installation(string directory) {
    string target = Path.GetFullPath(directory).TrimEnd('\\'); Normal(target);
    Need(!EqualPath(target, Root) && !Root.StartsWith(target + "\\", StringComparison.OrdinalIgnoreCase), "请把更新包解压到程序目录之外，再选择原程序目录。");
    Need(Directory.Exists(target) && File.Exists(Child(target, "resources\\app.asar")) && Executables.Any(name => File.Exists(Child(target, name))), "请选择原剪辑台程序文件夹，需包含 小马剪辑台.exe / XM剪辑台.exe / 黑曜信号台.exe 和 resources。无需选择具体旧版本。");
    string exe = Executables.Select(name => Child(target, name)).First(File.Exists);
    var metadata = FileVersionInfo.GetVersionInfo(exe);
    Need(new[] { "XM剪辑台", "小马剪辑台", "黑曜信号台", "black-obsidian-signal" }.Any(name => (metadata.ProductName ?? "").IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0 || (metadata.FileDescription ?? "").IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0), "所选目录不是可识别的剪辑台程序，原文件未修改。");
    Need(Environment.Is64BitOperatingSystem, "此全量更新适用于 Windows 10 / 11 64 位系统。");
    return target;
  }
  static void WriteJournal(string folder, FullBackup record) {
    string file = Child(folder, "backup.json"), temp = file + ".tmp";
    File.WriteAllText(temp, Json.Serialize(record), Encoding.UTF8);
    if (File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file);
  }
  static void CommitFile(string source, string target) {
    Directory.CreateDirectory(Path.GetDirectoryName(target));
    if (File.Exists(target)) File.Replace(source, target, null); else File.Move(source, target);
  }
  static void CheckFailure(int changed) {
#if UPDATE_TEST
    if (FailAfter > 0 && changed == FailAfter) throw new IOException("Injected transaction failure");
#endif
  }
  static void UpdateRegistry(string target, string version) {
    try {
      using (var key = Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\XiaomaEditingStudio", true))
        if (key != null && EqualPath(key.GetValue("InstallLocation") as string ?? "", target)) { key.SetValue("DisplayVersion", version); key.SetValue("DisplayName", "XM剪辑台"); }
    } catch { /* Program files and saved user data are authoritative. */ }
  }
  static string Apply(string directory) {
    var manifest = Manifest(); string target = Installation(directory);
    var files = manifest.files.Select(file => new SavedFile { name = file.name, source = file.name, afterHash = file.hash }).ToList();
    string newExeHash = manifest.files.First(file => file.name == Executables[0]).hash;
    foreach (string alias in Executables.Skip(1)) if (File.Exists(Child(target, alias))) files.Add(new SavedFile { name = alias, source = Executables[0], afterHash = newExeHash });
    Closed(target, files.Select(file => file.name));
    if (files.All(file => File.Exists(Child(target, file.name)) && Hash(Child(target, file.name)) == file.afterHash)) return "此目录已经是完整的 1.3.0，无需重复更新。";
    long required = manifest.files.Sum(file => file.bytes) + files.Where(file => File.Exists(Child(target, file.name))).Sum(file => new FileInfo(Child(target, file.name)).Length) + 64 * 1024 * 1024;
    Need(new DriveInfo(Path.GetPathRoot(target)).AvailableFreeSpace >= required, "程序所在磁盘空间不足，请至少预留 2 GB 以备份和更新。");
    string backup = Child(target, ".xiaoma-update-backups\\" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-full130-" + Guid.NewGuid().ToString("N").Substring(0, 8));
    string stage = Child(backup, "staged"); Directory.CreateDirectory(stage);
    string oldExe = Executables.Select(name => Child(target, name)).First(File.Exists);
    var record = new FullBackup { target = target, version = Version, previousVersion = FileVersionInfo.GetVersionInfo(oldExe).ProductVersion, state = "prepared", files = files.ToArray() };
    foreach (var file in files) {
      string current = Child(target, file.name), staged = Child(stage, file.name); Normal(current);
      file.existed = File.Exists(current); file.beforeHash = file.existed ? Hash(current) : null;
      Directory.CreateDirectory(Path.GetDirectoryName(staged)); File.Copy(Child(Child(Root, "payload"), file.source), staged, false); Verify(staged, file.afterHash);
      if (file.existed) { string saved = Child(Child(backup, "files"), file.name); Directory.CreateDirectory(Path.GetDirectoryName(saved)); File.Copy(current, saved, false); Verify(saved, file.beforeHash); }
    }
    WriteJournal(backup, record);
    var changed = new List<SavedFile>();
    try {
      Closed(target, files.Select(file => file.name));
      foreach (var file in files) {
        string current = Child(target, file.name);
        if (file.existed) Verify(current, file.beforeHash); else Need(!File.Exists(current), "程序目录发生变化，已停止。");
        CommitFile(Child(stage, file.name), current); changed.Add(file); CheckFailure(changed.Count);
      }
      foreach (var file in files) Verify(Child(target, file.name), file.afterHash);
      record.state = "complete"; WriteJournal(backup, record); UpdateRegistry(target, Version);
      return "已完整更新到 XM剪辑台 1.3.0。配置、历史、自定义目录和音乐文件均保留。\r\n原快捷方式可继续使用。\r\n回退备份：" + backup;
    } catch (Exception error) {
      var failures = new List<string>();
      foreach (var file in changed.AsEnumerable().Reverse()) try {
        string current = Child(target, file.name); Verify(current, file.afterHash);
        if (file.existed) { string rollback = Child(stage, file.name); File.Copy(Child(Child(backup, "files"), file.name), rollback, true); CommitFile(rollback, current); Verify(current, file.beforeHash); }
        else File.Delete(current);
      } catch (Exception failure) { failures.Add(failure.Message); }
      record.state = failures.Count == 0 ? "rolled-back" : "recovery-needed"; WriteJournal(backup, record);
      throw new IOException(error.Message + (failures.Count == 0 ? "\r\n已恢复更新前的程序。" : "\r\n部分文件需要从备份恢复：" + backup + "\r\n" + string.Join("\r\n", failures)), error);
    }
  }
  static string Restore(string directory) {
    string backup = Path.GetFullPath(directory).TrimEnd('\\'); Normal(backup);
    var record = Json.Deserialize<FullBackup>(File.ReadAllText(Child(backup, "backup.json"), Encoding.UTF8));
    string target = Path.GetDirectoryName(Path.GetDirectoryName(backup));
    Need(record != null && record.version == Version && record.files != null && EqualPath(record.target, target) && Path.GetFileName(Path.GetDirectoryName(backup)) == ".xiaoma-update-backups", "请选择 1.3.0 全量更新生成的备份文件夹。");
    var manifest = Manifest();
    foreach (var file in record.files) {
      var expected = manifest.files.FirstOrDefault(item => item.name == file.name || Executables.Contains(file.name) && item.name == Executables[0]);
      Need(expected != null && expected.hash == file.afterHash, "备份清单与更新程序不一致。");
    }
    Need(record.files.Select(file => file.name).Distinct(StringComparer.OrdinalIgnoreCase).Count() == record.files.Length && manifest.files.All(item => record.files.Any(file => file.name == item.name)), "备份清单不完整。");
    Closed(target, record.files.Select(file => file.name));
    string stage = Child(backup, "restore-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(stage);
    var changed = new List<SavedFile>(); var previous = new Dictionary<string, string>();
    foreach (var file in record.files) {
      string current = Child(target, file.name); Normal(current);
      string currentHash = File.Exists(current) ? Hash(current) : null;
      Need(currentHash == file.afterHash || currentHash == file.beforeHash, "当前程序已被其他更新修改，不能覆盖回退：" + file.name);
      previous[file.name] = currentHash;
      if (currentHash != null) { string saved = Child(Child(stage, "current"), file.name); Directory.CreateDirectory(Path.GetDirectoryName(saved)); File.Copy(current, saved, false); Verify(saved, currentHash); }
      if (file.existed) { string saved = Child(Child(backup, "files"), file.name); Verify(saved, file.beforeHash); string restored = Child(Child(stage, "desired"), file.name); Directory.CreateDirectory(Path.GetDirectoryName(restored)); File.Copy(saved, restored, false); }
    }
    try {
      Closed(target, record.files.Select(file => file.name));
      foreach (var file in record.files) {
        string current = Child(target, file.name);
        if (previous[file.name] != null) Verify(current, previous[file.name]); else Need(!File.Exists(current), "文件在恢复过程中发生变化。");
        if (file.existed) CommitFile(Child(Child(stage, "desired"), file.name), current); else if (File.Exists(current)) File.Delete(current);
        changed.Add(file); CheckFailure(changed.Count);
      }
      foreach (var file in record.files) { if (file.existed) Verify(Child(target, file.name), file.beforeHash); else Need(!File.Exists(Child(target, file.name)), "新增文件恢复校验失败。"); }
      record.state = "restored"; WriteJournal(backup, record); UpdateRegistry(target, record.previousVersion ?? "");
      return "已恢复更新前的程序文件，个人数据保留。";
    } catch {
      foreach (var file in changed.AsEnumerable().Reverse()) {
        string current = Child(target, file.name);
        if (previous[file.name] != null) CommitFile(Child(Child(stage, "current"), file.name), current); else if (File.Exists(current)) File.Delete(current);
      }
      throw;
    }
  }
  [STAThread] static int Main(string[] args) {
    Application.EnableVisualStyles();
#if UPDATE_TEST
    foreach (var arg in args.Where(arg => arg.StartsWith("--fail-after="))) FailAfter = int.Parse(arg.Substring(13));
#endif
    bool restore = args.Contains("--restore"), silent = args.Contains("--silent");
    string directory = args.LastOrDefault(arg => !arg.StartsWith("--"));
    if (directory == null) using (var picker = new FolderBrowserDialog { Description = restore ? "选择 .xiaoma-update-backups 中含 full130 的备份文件夹" : "选择原剪辑台的程序文件夹，任意旧版本可直接更新到 1.3.0", ShowNewFolderButton = false }) { if (picker.ShowDialog() != DialogResult.OK) return 2; directory = picker.SelectedPath; }
    Func<string> operation = () => restore ? Restore(directory) : Apply(directory);
    if (silent) { try { File.WriteAllText(Child(Root, "last-result.txt"), operation(), Encoding.UTF8); return 0; } catch (Exception error) { File.WriteAllText(Child(Root, "last-result.txt"), error.ToString(), Encoding.UTF8); return 1; } }
    if (MessageBox.Show((restore ? "恢复到本次全量更新前的程序？" : "将此目录完整更新到 XM剪辑台 1.3.0，不要求旧版本号或特定文件基线。\r\n更新前自动备份，保留个人配置、历史和音乐。") + "\r\n请先保存任务并退出剪辑台。\r\n\r\n" + directory, "XM剪辑台全量更新", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return 2;
    int result = 1;
    var form = new Form { Text = "XM剪辑台 · 1.3.0 全量更新", Width = 560, Height = 160, StartPosition = FormStartPosition.CenterScreen, ControlBox = false };
    form.Controls.Add(new Label { Dock = DockStyle.Fill, Text = "正在校验、备份并更新全部程序文件，请稍候…", TextAlign = System.Drawing.ContentAlignment.MiddleCenter });
    form.Shown += async (sender, e) => { string message; try { message = await Task.Run(operation); result = 0; } catch (Exception error) { message = "操作未完成：" + error.Message; } MessageBox.Show(form, message, "XM剪辑台", MessageBoxButtons.OK, result == 0 ? MessageBoxIcon.Information : MessageBoxIcon.Error); form.Close(); };
    Application.Run(form); return result;
  }
}
