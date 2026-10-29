using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Threading.Tasks;
using System.Threading;
using System.Diagnostics;
using Microsoft.Win32;
[assembly: System.Reflection.AssemblyTitle("XM剪辑台 1.3.1 累计增量更新")]
[assembly: System.Reflection.AssemblyProduct("XM剪辑台")]
[assembly: System.Reflection.AssemblyVersion("1.3.1.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.3.1.0")]

public class RuntimeFile { public string name, hash; public long bytes; }
public class DeltaFile { public string name, beforeHash, afterHash, patch, patchHash; public long bytes; }
public class Variant { public string id, fromVersion; public DeltaFile[] files; }
public class Bundle { public string product, version, revision; public RuntimeFile[] files, runtime, blocks; public Variant[] variants; }
public class SavedFile { public string name, source, beforeHash, afterHash; }
public class Backup { public string target, version, revision, previousVersion, variant, state; public SavedFile[] files; }
static class IncrementalUpdater {
  const string Version = "1.3.1";
  static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
  static readonly string[] Names = { "小马剪辑台.exe", "resources\\app.asar", "resources\\helpers\\PeriodKeeper.exe" };
  static readonly string[] Aliases = { "XM剪辑台.exe", "黑曜信号台.exe" };
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
#if UPDATE_TEST
  static int FailAfter;
#endif
  static void Need(bool ok, string message) { if (!ok) throw new IOException(message); }
  static string Hash(string file) { using (var sha = SHA256.Create()) using (var stream = File.OpenRead(file)) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
  static string TextHash(string text) { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", ""); }
  static string Child(string root, string name) {
    Need(!string.IsNullOrEmpty(name) && !Path.IsPathRooted(name) && !name.Contains(":"), "清单路径无效。");
    string file = Path.GetFullPath(Path.Combine(root, name));
    Need(file.StartsWith(Path.GetFullPath(root).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase), "清单路径超出程序目录。"); return file;
  }
  static void Normal(string file) {
    for (string at = Path.GetFullPath(file); !string.IsNullOrEmpty(at); at = Path.GetDirectoryName(at))
      if (File.Exists(at) || Directory.Exists(at)) Need((File.GetAttributes(at) & FileAttributes.ReparsePoint) == 0, "更新路径不能包含目录联接或符号链接：" + at);
  }
  static bool EqualPath(string a, string b) { return string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase); }
  static void Verify(string file, string hash) { Normal(file); Need(File.Exists(file) && Hash(file) == hash, "文件校验失败：" + file); }
  static void Closed(string target, IEnumerable<string> names) {
    foreach (var process in Process.GetProcesses()) using (process) {
      string executable = null; try { executable = process.MainModule.FileName; } catch { }
      Need(executable == null || !executable.StartsWith(target + "\\", StringComparison.OrdinalIgnoreCase), "请先保存任务并完全退出剪辑台，再执行更新。检测到程序仍在运行。");
    }
    foreach (string name in names.Distinct(StringComparer.OrdinalIgnoreCase)) {
      string file = Child(target, name); Normal(file);
      Need(File.Exists(file), "所选目录缺少程序文件：" + name);
      try { using (var stream = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) {} }
      catch (IOException) { throw new IOException("程序文件正在使用，请退出剪辑台后重试：" + name); }
    }
  }
  static Bundle Manifest() {
    Verify(Child(Root, "manifest.json"), IncrementalManifestHash.Value);
    var bundle = Json.Deserialize<Bundle>(File.ReadAllText(Child(Root, "manifest.json"), Encoding.UTF8));
    Need(bundle != null && bundle.version == Version && bundle.product == "XM剪辑台" && bundle.files != null && bundle.files.Select(f => f.name).SequenceEqual(Names) && bundle.variants != null && bundle.variants.Length > 0 && bundle.runtime != null && bundle.runtime.Length > 0, "更新清单无效。");
    foreach (var variant in bundle.variants) {
      Need((variant.fromVersion == "1.3.0" || variant.fromVersion == Version) && variant.files != null && variant.files.Select(f => f.name).SequenceEqual(Names), "更新基线无效。");
      foreach (var file in variant.files) { var expected = bundle.files.First(f => f.name == file.name); Need(file.afterHash == expected.hash && file.bytes == expected.bytes && file.bytes > 0, "更新目标不一致。"); Child(Root, file.patch); }
    }
    return bundle;
  }
  static string Installation(string directory) {
    string target = Path.GetFullPath(directory).TrimEnd('\\'); Normal(target);
    Need(!EqualPath(target, Root) && !Root.StartsWith(target + "\\", StringComparison.OrdinalIgnoreCase), "请把更新包解压到程序目录之外，再选择原程序目录。");
    Need(Environment.Is64BitOperatingSystem, "此更新适用于 Windows 10 / 11 64 位系统。");
    Need(Names.All(name => File.Exists(Child(target, name))), "请选择原程序文件夹，需包含 小马剪辑台.exe 和 resources；不要选择 resources 或更新包文件夹。");
    return target;
  }
  static void CheckRuntime(Bundle bundle, string target) { foreach (var file in bundle.runtime) Verify(Child(target, file.name), file.hash); }
  static void CopyBytes(Stream source, Stream output, long count) {
    byte[] buffer = new byte[65536];
    while (count > 0) { int got = source.Read(buffer, 0, (int)Math.Min(buffer.Length, count)); if (got <= 0) throw new EndOfStreamException("更新数据不完整。"); output.Write(buffer, 0, got); count -= got; }
  }
  static void Patch(string sourceFile, string patchFile, string outputFile, long expectedLength, Bundle bundle) {
    using (var source = File.OpenRead(sourceFile)) using (var patch = new BinaryReader(File.OpenRead(patchFile))) using (var output = new FileStream(outputFile, FileMode.CreateNew, FileAccess.Write)) {
      Need(Encoding.ASCII.GetString(patch.ReadBytes(8)) == "XMPATCH2", "差异文件格式错误。");
      while (patch.BaseStream.Position < patch.BaseStream.Length) {
        byte op = patch.ReadByte(); long offset = op == 0 ? patch.ReadInt64() : 0;
        string blockHash = op == 2 ? BitConverter.ToString(patch.ReadBytes(32)).Replace("-", "").ToLowerInvariant() : null;
        int count = patch.ReadInt32();
        Need((op == 0 || op == 1 || op == 2) && count > 0 && output.Position + count <= expectedLength, "差异数据超出范围。");
        if (op == 0) { Need(offset >= 0 && offset <= source.Length - count, "原文件范围无效。"); source.Position = offset; CopyBytes(source, output, count); }
        else if (op == 1) CopyBytes(patch.BaseStream, output, count);
        else {
          var block = bundle.blocks.FirstOrDefault(b => b.hash == blockHash && b.bytes == count);
          Need(block != null, "更新块清单不匹配。"); string file = Child(Root, block.name); Verify(file, block.hash);
          using (var stream = File.OpenRead(file)) { Need(stream.Length == count, "更新块长度错误。"); CopyBytes(stream, output, count); }
        }
      }
      Need(output.Position == expectedLength, "重建文件大小不匹配。"); output.Flush(true);
    }
  }
  static void WriteJournal(string folder, Backup record) {
    string file = Child(folder, "backup.json"), temp = file + ".tmp"; Normal(file);
    File.WriteAllText(temp, Json.Serialize(record), Encoding.UTF8);
    if (File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file);
  }
  static void Replace(string source, string target) { Normal(target); File.Replace(source, target, null); }
  static void CheckFailure(int count) {
#if UPDATE_TEST
    if (FailAfter > 0 && count == FailAfter) throw new IOException("Injected transaction failure");
#endif
  }
  static void Cleanup(string directory, IEnumerable<string> names) {
    // Delete only known temporary files and empty parents, never recurse into user folders.
    var parents = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (string name in names) try {
      string file = Child(directory, name); Normal(file); if (File.Exists(file)) File.Delete(file);
      for (string at = Path.GetDirectoryName(file); at.StartsWith(directory + "\\", StringComparison.OrdinalIgnoreCase); at = Path.GetDirectoryName(at)) parents.Add(at);
    } catch { }
    foreach (string parent in parents.OrderByDescending(p => p.Length)) try { if (Directory.Exists(parent)) Directory.Delete(parent, false); } catch { }
    try { if (Directory.Exists(directory)) Directory.Delete(directory, false); } catch { }
  }
  static void UpdateRegistry(string target, string version) {
    try { using (var key = Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\XiaomaEditingStudio", true))
      if (key != null && EqualPath(key.GetValue("InstallLocation") as string ?? "", target)) { key.SetValue("DisplayVersion", version); key.SetValue("DisplayName", "XM剪辑台"); }
    } catch { }
  }
  static string Apply(string directory) {
    var bundle = Manifest(); string target = Installation(directory);
    var aliases = Aliases.Where(name => File.Exists(Child(target, name))).ToArray();
    Closed(target, Names.Concat(aliases)); CheckRuntime(bundle, target);
    var hashes = Names.ToDictionary(name => name, name => Hash(Child(target, name)));
    foreach (string alias in aliases) Verify(Child(target, alias), hashes[Names[0]]);
    if (bundle.files.All(file => hashes[file.name] == file.hash)) return "此目录已包含本次 1.3.1 累计更新、DeepSeek 改进及称谓句点和横线保留修复，无需重复更新。";
    var variant = bundle.variants.FirstOrDefault(v => v.files.All(file => hashes[file.name] == file.beforeHash));
    Need(variant != null, "此目录的文件组合不在增量包支持的已发布 1.3.0 / 1.3.1 版本内。原文件未改动，请确认目录；不要手动混用 EXE 与 app.asar。");
    foreach (var file in variant.files) Verify(Child(Root, file.patch), file.patchHash);
    var files = variant.files.Where(file => file.beforeHash != file.afterHash).Select(file => new SavedFile { name = file.name, source = file.name, beforeHash = file.beforeHash, afterHash = file.afterHash }).ToList();
    if (files.Any(file => file.name == Names[0])) foreach (string alias in aliases) { var exe = files.First(file => file.name == Names[0]); files.Add(new SavedFile { name = alias, source = exe.source, beforeHash = exe.beforeHash, afterHash = exe.afterHash }); }
    long required = files.Sum(file => new FileInfo(Child(target, file.name)).Length + bundle.files.First(f => f.name == file.source).bytes) + 64 * 1024 * 1024;
    Need(new DriveInfo(Path.GetPathRoot(target)).AvailableFreeSpace >= required, "程序所在磁盘空间不足，请至少预留 2 GB 用于重建和备份。");
    string backup = Child(target, ".xiaoma-update-backups\\" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-delta131-" + Guid.NewGuid().ToString("N").Substring(0, 8));
    Normal(backup); string stage = Child(backup, "staged"), saved = Child(backup, "files"); Directory.CreateDirectory(stage);
    var record = new Backup { target = target, version = Version, revision = bundle.revision, previousVersion = variant.fromVersion, variant = variant.id, state = "preparing", files = files.ToArray() };
    var changed = new List<SavedFile>();
    try {
      foreach (var file in files) {
        var patch = variant.files.First(f => f.name == file.source);
        string staged = Child(stage, file.name), original = Child(target, file.name), old = Child(saved, file.name);
        Directory.CreateDirectory(Path.GetDirectoryName(staged)); Directory.CreateDirectory(Path.GetDirectoryName(old));
        Patch(original, Child(Root, patch.patch), staged, patch.bytes, bundle); Verify(staged, file.afterHash);
        File.Copy(original, old, false); Verify(old, file.beforeHash);
      }
      record.state = "prepared"; WriteJournal(backup, record); Closed(target, files.Select(f => f.name));
      foreach (var file in files) { Verify(Child(target, file.name), file.beforeHash); Replace(Child(stage, file.name), Child(target, file.name)); changed.Add(file); CheckFailure(changed.Count); }
      foreach (var file in files) Verify(Child(target, file.name), file.afterHash);
      record.state = "complete"; WriteJournal(backup, record); UpdateRegistry(target, Version);
      return "已更新到 XM剪辑台 1.3.1，包含 1.3.0 之后的全部改进、DeepSeek 兼容修复及称谓句点和横线保留修复。\r\n配置、历史、音乐和快捷方式保留。\r\n回退备份：" + backup;
    } catch (Exception error) {
      var failures = new List<string>();
      foreach (var file in changed.AsEnumerable().Reverse()) try {
        Verify(Child(target, file.name), file.afterHash); Verify(Child(saved, file.name), file.beforeHash);
        string rollback = Child(stage, file.name); File.Copy(Child(saved, file.name), rollback, true); Replace(rollback, Child(target, file.name)); Verify(Child(target, file.name), file.beforeHash);
      } catch (Exception failure) { failures.Add(failure.Message); }
      record.state = failures.Count == 0 ? "rolled-back" : "recovery-needed"; WriteJournal(backup, record);
      throw new IOException(error.Message + (failures.Count == 0 ? "\r\n原程序未变更或已自动恢复。" : "\r\n请保留备份用于恢复：" + backup + "\r\n" + string.Join("\r\n", failures)), error);
    } finally { Cleanup(stage, files.Select(f => f.name)); }
  }
  static string Restore(string directory) {
    var bundle = Manifest(); string backup = Path.GetFullPath(directory).TrimEnd('\\'); Normal(backup);
    var record = Json.Deserialize<Backup>(File.ReadAllText(Child(backup, "backup.json"), Encoding.UTF8));
    string target = Path.GetDirectoryName(Path.GetDirectoryName(backup));
    Need(record != null && record.version == Version && record.revision == bundle.revision && record.files != null && EqualPath(record.target, target) && Path.GetFileName(Path.GetDirectoryName(backup)) == ".xiaoma-update-backups", "请选择本次增量包创建的 delta131 备份文件夹。");
    Normal(target); var variant = bundle.variants.FirstOrDefault(v => v.id == record.variant);
    Need(variant != null && record.previousVersion == variant.fromVersion && record.files.Select(f => f.name).Distinct(StringComparer.OrdinalIgnoreCase).Count() == record.files.Length, "备份清单无效。");
    foreach (var file in record.files) {
      var expected = variant.files.FirstOrDefault(f => f.name == file.source);
      Need(expected != null && (file.name == file.source || Aliases.Contains(file.name) && file.source == Names[0]) && file.beforeHash == expected.beforeHash && file.afterHash == expected.afterHash && file.beforeHash != file.afterHash, "备份清单与本次更新不一致。");
    }
    Need(variant.files.Where(f => f.beforeHash != f.afterHash).All(f => record.files.Any(r => r.name == f.name)), "备份清单不完整。");
    Closed(target, record.files.Select(f => f.name)); CheckRuntime(bundle, target);
    foreach (var unchanged in variant.files.Where(f => f.beforeHash == f.afterHash)) Verify(Child(target, unchanged.name), unchanged.afterHash);
    var previous = new Dictionary<string, string>();
    foreach (var file in record.files) { Verify(Child(Child(backup, "files"), file.name), file.beforeHash); Normal(Child(target, file.name)); var hash = Hash(Child(target, file.name)); Need(hash == file.beforeHash || hash == file.afterHash, "当前程序已被其他更新修改，不能覆盖回退：" + file.name); previous[file.name] = hash; }
    if (record.files.All(f => previous[f.name] == f.beforeHash)) return "已经恢复到本次更新前的程序，无需重复恢复。";
    long required = record.files.Sum(file => new FileInfo(Child(target, file.name)).Length + new FileInfo(Child(Child(backup, "files"), file.name)).Length) + 64 * 1024 * 1024;
    Need(new DriveInfo(Path.GetPathRoot(target)).AvailableFreeSpace >= required, "磁盘空间不足，无法安全恢复备份。");
    string stage = Child(backup, "restore-" + Guid.NewGuid().ToString("N")), current = Child(stage, "current"), desired = Child(stage, "desired");
    var changed = new List<SavedFile>();
    try {
      foreach (var file in record.files) {
        Directory.CreateDirectory(Path.GetDirectoryName(Child(current, file.name))); Directory.CreateDirectory(Path.GetDirectoryName(Child(desired, file.name)));
        File.Copy(Child(target, file.name), Child(current, file.name), false); Verify(Child(current, file.name), previous[file.name]);
        File.Copy(Child(Child(backup, "files"), file.name), Child(desired, file.name), false); Verify(Child(desired, file.name), file.beforeHash);
      }
      Closed(target, record.files.Select(f => f.name));
      foreach (var file in record.files) { Verify(Child(target, file.name), previous[file.name]); Replace(Child(desired, file.name), Child(target, file.name)); changed.Add(file); CheckFailure(changed.Count); }
      foreach (var file in record.files) Verify(Child(target, file.name), file.beforeHash);
      record.state = "restored"; WriteJournal(backup, record); UpdateRegistry(target, variant.fromVersion);
      return "已恢复到更新前的 " + variant.fromVersion + "，配置、历史和音乐保留。";
    } catch (Exception error) {
      var failures = new List<string>();
      foreach (var file in changed.AsEnumerable().Reverse()) try { Verify(Child(target, file.name), file.beforeHash); Replace(Child(current, file.name), Child(target, file.name)); Verify(Child(target, file.name), previous[file.name]); } catch (Exception failure) { failures.Add(failure.Message); }
      if (failures.Count != 0) { record.state = "restore-recovery-needed"; WriteJournal(backup, record); throw new IOException(error.Message + "\r\n恢复未完成，请保留备份和恢复暂存目录：" + stage, error); }
      throw new IOException(error.Message + "\r\n已撤回本次恢复操作，程序保持恢复前状态。", error);
    } finally { if (record.state != "restore-recovery-needed") { Cleanup(current, record.files.Select(f => f.name)); Cleanup(desired, record.files.Select(f => f.name)); Cleanup(stage, new string[0]); } }
  }
  static string Operate(string directory, bool restore) {
    string target = Path.GetFullPath(restore ? Path.GetDirectoryName(Path.GetDirectoryName(directory.TrimEnd('\\'))) : directory).TrimEnd('\\');
    using (var mutex = new Mutex(false, "Local\\XM-Incremental-" + TextHash(target.ToUpperInvariant()))) {
      bool owned = false;
      try { try { owned = mutex.WaitOne(0); } catch (AbandonedMutexException) { owned = true; } Need(owned, "此目录正在更新，请等待当前更新完成。"); return restore ? Restore(directory) : Apply(directory); }
      finally { if (owned) mutex.ReleaseMutex(); }
    }
  }
  [STAThread] static int Main(string[] args) {
    Application.EnableVisualStyles();
#if UPDATE_TEST
    foreach (var arg in args.Where(a => a.StartsWith("--fail-after="))) FailAfter = int.Parse(arg.Substring(13));
#endif
    bool restore = args.Contains("--restore"), silent = args.Contains("--silent");
    string directory = args.LastOrDefault(a => !a.StartsWith("--"));
    if (directory == null) using (var picker = new FolderBrowserDialog { Description = restore ? "选择 .xiaoma-update-backups 中含 delta131 的备份文件夹" : "选择已安装的 1.3.0 / 1.3.1 程序文件夹（含 小马剪辑台.exe）", ShowNewFolderButton = false }) { if (picker.ShowDialog() != DialogResult.OK) return 2; directory = picker.SelectedPath; }
    if (silent) { try { File.WriteAllText(Child(Root, "last-result.txt"), Operate(directory, restore), Encoding.UTF8); return 0; } catch (Exception error) { try { File.WriteAllText(Child(Root, "last-result.txt"), error.ToString(), Encoding.UTF8); } catch { } return 1; } }
    if (MessageBox.Show((restore ? "恢复到本次更新前的程序？" : "自动识别 1.3.0 / 1.3.1，安装累计更新、DeepSeek 改进及称谓句点和横线保留修复。\r\n更新前自动备份，保留配置、历史和音乐。") + "\r\n请先保存任务并完全退出剪辑台。\r\n\r\n" + directory, "XM剪辑台 1.3.1 增量更新", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return 2;
    int result = 1;
    var form = new Form { Text = "XM剪辑台 · 1.3.1 累计增量更新", Width = 560, Height = 160, StartPosition = FormStartPosition.CenterScreen, ControlBox = false };
    form.Controls.Add(new Label { Dock = DockStyle.Fill, Text = "正在校验、备份并应用更新，请稍候…", TextAlign = System.Drawing.ContentAlignment.MiddleCenter });
    form.Shown += async (sender, e) => { string message; try { message = await Task.Run(() => Operate(directory, restore)); result = 0; } catch (Exception error) { message = "操作未完成：" + error.Message; } MessageBox.Show(form, message, "XM剪辑台", MessageBoxButtons.OK, result == 0 ? MessageBoxIcon.Information : MessageBoxIcon.Error); form.Close(); };
    Application.Run(form); return result;
  }
}
