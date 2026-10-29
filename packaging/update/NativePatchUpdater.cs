using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Reflection;
using System.Web.Script.Serialization;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class NativePatchUpdater {
    public sealed class Entry { public string name, before, after; }
    public sealed class Baseline { public string version; public Dictionary<string,string> files; }
    public sealed class Manifest { public string version, baseVersion, marker; public Entry[] changed; public Dictionary<string,string> retained; public Baseline[] baselines; }
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 20000000 };
    static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    static int failAfter;
    static Manifest Load() {
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("patch.json"))
        using (var reader = new StreamReader(stream, Encoding.UTF8)) return Json.Deserialize<Manifest>(reader.ReadToEnd());
    }
    static void Need(bool ok, string message) { if (!ok) throw new IOException(message); }
    static string Supported(Manifest manifest) { return string.Join(" / ",manifest.baselines.Select(item=>item.version).Distinct()); }
    static string Hash(string path) {
        using (var stream = File.OpenRead(path)) using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    static void Real(string path) {
        for (string at = Path.GetFullPath(path); !string.IsNullOrEmpty(at); at = Path.GetDirectoryName(at))
            if (File.Exists(at) || Directory.Exists(at)) Need((File.GetAttributes(at) & FileAttributes.ReparsePoint) == 0, "目录不能包含链接：" + at);
    }
    static string Child(string parent, string relative) {
        string full = Path.GetFullPath(Path.Combine(parent, relative));
        Need(!Path.IsPathRooted(relative) && full.StartsWith(parent.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase), "更新清单路径无效。");
        Real(full); return full;
    }
    static void Verify(string file, string hash) { Need(File.Exists(file) && Hash(file) == hash, "文件校验不匹配：" + file); }
    static void Closed(string target) {
        foreach (var process in Process.GetProcesses()) using (process) {
            string file = null;
            try { file = process.MainModule.FileName; } catch { }
            Need(file == null || !file.StartsWith(target + "\\", StringComparison.OrdinalIgnoreCase), "请保存任务，从托盘彻底退出该目录的 XM剪辑台和桌宠，再运行更新。更新包请解压到安装目录之外。");
        }
    }
    static string Apply(string selected, bool verifyOnly) {
        var manifest = Load(); string target = Path.GetFullPath(selected).TrimEnd('\\'); Real(target);
        Need(target.Length > Path.GetPathRoot(target).TrimEnd('\\').Length && Directory.Exists(target), "请选择已经安装的 XM剪辑台文件夹。");
        Need(target.IndexOf("fork", StringComparison.OrdinalIgnoreCase) < 0 && target.IndexOf("kirota", StringComparison.OrdinalIgnoreCase) < 0 && !File.Exists(Child(target,"xm-fork-install.id")), "请选择原版 XM剪辑台目录，另一版本保持独立。");
        Need(File.Exists(Child(target,"xiaoma-install.id")) && File.ReadAllText(Child(target,"xiaoma-install.id")).Trim() == manifest.marker, "未找到原版安装标记。");
        string exe = Child(target,"小马剪辑台.exe");
        var version = File.Exists(exe) ? FileVersionInfo.GetVersionInfo(exe).ProductVersion : "";
        Need(manifest.baselines != null && manifest.baselines.Length > 0, "更新包缺少兼容版本清单，请重新下载。");
        Need(manifest.baselines.Any(item => version == item.version + ".0") || version == manifest.version + ".0", "此增量更新包支持原版 " + Supported(manifest) + "。旧版本请先升级到 " + manifest.baseVersion + " 完整版。");
        Closed(target);
        foreach (var file in manifest.changed) Verify(Child(Path.Combine(Root,"payload"),file.name),file.after);
        // Check the installed components that are deliberately omitted from this small package.
        foreach (var file in manifest.retained) Verify(Child(target,file.Key),file.Value);
        var current = manifest.changed.ToDictionary(file => file.name, file => File.Exists(Child(target,file.name)) ? Hash(Child(target,file.name)) : "");
        if (manifest.changed.All(file => current[file.name] == file.after)) return "已安装本次 " + manifest.version + " 更新，无需重复更新。";
        // Match one complete build, not independent per-file allowlists: a mixed
        // installation must not be mistaken for another supported revision.
        var baseline = manifest.baselines.FirstOrDefault(item => version == item.version + ".0" && manifest.changed.All(file => item.files.ContainsKey(file.name) && current[file.name] == item.files[file.name]));
        Need(baseline != null, "当前文件不属于本包支持的完整 " + Supported(manifest) + " 版本，可能存在混用或修改。原文件未修改，请保留安装目录并获取对应更新包。");
        var changes = manifest.changed.Select(file => new Entry { name=file.name, before=current[file.name], after=file.after }).ToArray();
        if (verifyOnly) return "更新前校验通过。";
        Need(new DriveInfo(Path.GetPathRoot(target)).AvailableFreeSpace > manifest.changed.Sum(file => new FileInfo(Child(Path.Combine(Root,"payload"),file.name)).Length) * 3 + 32 * 1024 * 1024, "磁盘空间不足，请至少预留 64 MB。");
        string backup = Child(target,".xiaoma-update-backups\\" + manifest.version + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0,6));
        Directory.CreateDirectory(backup); var done = new List<Entry>();
        Action<string> journal = state => File.WriteAllText(Path.Combine(backup,"backup.json"), Json.Serialize(new { state, target, version=manifest.version, baseVersion=baseline.version, files=changes }), new UTF8Encoding(false));
        journal("preparing");
        try {
            foreach (var file in changes) {
                string staged = Child(backup,"staged\\" + file.name), saved = Child(backup,"files\\" + file.name);
                Directory.CreateDirectory(Path.GetDirectoryName(staged)); Directory.CreateDirectory(Path.GetDirectoryName(saved));
                File.Copy(Child(Path.Combine(Root,"payload"),file.name),staged); Verify(staged,file.after);
                if (file.before.Length > 0) { File.Copy(Child(target,file.name),saved); Verify(saved,file.before); }
            }
            Closed(target); journal("applying");
            foreach (var file in changes) {
                string destination = Child(target,file.name), staged=Child(backup,"staged\\"+file.name);
                if (file.before.Length > 0) { Verify(destination,file.before); File.Replace(staged,destination,null); }
                else { Need(!File.Exists(destination), "更新期间出现同名文件。"); Directory.CreateDirectory(Path.GetDirectoryName(destination)); File.Move(staged,destination); }
                done.Add(file); Verify(destination,file.after);
#if UPDATE_TEST
                if (failAfter > 0 && done.Count == failAfter) throw new IOException("Injected update failure");
#endif
            }
            journal("complete");
        } catch (Exception error) {
            try {
                foreach (var file in done.AsEnumerable().Reverse()) {
                    string destination=Child(target,file.name);
                    if (file.before.Length > 0) {
                        string restore=Child(backup,"restore\\"+file.name); Directory.CreateDirectory(Path.GetDirectoryName(restore));
                        File.Copy(Child(backup,"files\\"+file.name),restore); File.Replace(restore,destination,null); Verify(destination,file.before);
                    } else if (File.Exists(destination)) File.Delete(destination);
                }
                journal("rolled-back");
            } catch (Exception rollback) { journal("rollback-failed"); throw new IOException("更新失败且自动恢复未完成，请保留备份："+backup+"\n"+error.Message+"\n"+rollback.Message); }
            throw new IOException("更新未完成，已恢复原文件。备份："+backup+"\n"+error.Message);
        }
        try {
            using (var key=Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\XiaomaEditingStudio",true))
                if (key!=null && string.Equals(Convert.ToString(key.GetValue("InstallLocation")),target,StringComparison.OrdinalIgnoreCase)) key.SetValue("DisplayVersion",manifest.version);
        } catch { }
        return "已更新至 " + manifest.version + "。配置、任务、音乐及桌宠数据均保留。\n备份："+backup;
    }
    [STAThread] static int Main(string[] args) {
        if (args.Length >= 2 && args[0] == "--target") {
            try { Console.OutputEncoding = new UTF8Encoding(false); } catch (IOException) { }
#if UPDATE_TEST
            int.TryParse(Environment.GetEnvironmentVariable("XM_PATCH_FAIL_AFTER"),out failAfter);
#endif
            try { string result=Apply(args[1],args.Contains("--verify-only")); try { Console.WriteLine(result); } catch(IOException) { } return 0; }
            catch (Exception error) { try { Console.Error.WriteLine(error.Message); } catch(IOException) { } return 1; }
        }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        var manifest = Load();
        var form = new Form { Text="XM剪辑台 " + manifest.version + " 增量更新包", ClientSize=new Size(590,210), StartPosition=FormStartPosition.CenterScreen, FormBorderStyle=FormBorderStyle.FixedDialog, MaximizeBox=false };
        var title = new Label { Text="支持原版 " + Supported(manifest) + "，更新至 " + manifest.version + "。请先彻底退出软件。", AutoSize=true, Location=new Point(20,20) };
        var folder = new TextBox { Location=new Point(20,54), Width=450 };
        using (var key=Registry.CurrentUser.OpenSubKey("Software\\Xiaoma\\EditingStudio")) if(key!=null) folder.Text=Convert.ToString(key.GetValue("InstallLocation"));
        var browse = new Button { Text="选择目录", Location=new Point(480,52), Width=90 };
        var update = new Button { Text="开始更新", Location=new Point(450,102), Size=new Size(120,36) };
        var status = new Label { Text="只替换变更文件，更新前自动备份。", Location=new Point(20,110), Size=new Size(420,80) };
        bool busy=false;
        browse.Click += (s,e) => { using(var dialog=new FolderBrowserDialog { Description="选择已安装的原版 XM剪辑台目录", SelectedPath=folder.Text }) if(dialog.ShowDialog(form)==DialogResult.OK) folder.Text=dialog.SelectedPath; };
        update.Click += async (s,e) => {
            busy=true; update.Enabled=browse.Enabled=folder.Enabled=false; status.Text="正在校验与更新，请稍候…"; string selected=folder.Text;
            try { string result=await Task.Run(()=>Apply(selected,false)); status.Text="更新完成。"; MessageBox.Show(form,result,"XM剪辑台",MessageBoxButtons.OK,MessageBoxIcon.Information); }
            catch(Exception error) { status.Text="更新未完成。"; MessageBox.Show(form,error.Message,"XM剪辑台",MessageBoxButtons.OK,MessageBoxIcon.Warning); }
            finally { busy=false;update.Enabled=browse.Enabled=folder.Enabled=true; }
        };
        form.FormClosing += (s,e)=>{if(busy)e.Cancel=true;};
        form.Controls.AddRange(new Control[]{title,folder,browse,update,status}); Application.Run(form); return 0;
    }
}
