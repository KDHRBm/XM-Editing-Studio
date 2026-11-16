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
using System.Threading;
using System.Runtime.InteropServices;
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
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetLongPathName(string shortPath, StringBuilder longPath, uint length);
    static string Canonical(string path) {
        string full=Path.GetFullPath(path).TrimEnd('\\'); var buffer=new StringBuilder(32768);
        uint length=GetLongPathName(full,buffer,(uint)buffer.Capacity);
        return length>0 && length<buffer.Capacity ? buffer.ToString().TrimEnd('\\') : full;
    }
    static bool Inside(string file,string directory) { return file.StartsWith(directory+"\\",StringComparison.OrdinalIgnoreCase); }
    sealed class RelatedProcess {
        internal int Id;
        internal long Started;
        internal string File;
        public override string ToString() { return Path.GetFileName(File)+" (PID "+Id+")"; }
    }
    // Match the executable path, never its name: another installation may use the same Ollama or helper name.
    static List<RelatedProcess> RelatedProcesses(string selected) {
        string target=Canonical(selected);var found=new List<RelatedProcess>();
        foreach(var process in Process.GetProcesses())using(process) {
            try {
                var module=process.MainModule;if(module==null || string.IsNullOrEmpty(module.FileName))continue;
                string file=Canonical(module.FileName);
                if(Inside(file,target))found.Add(new RelatedProcess{Id=process.Id,Started=process.StartTime.ToUniversalTime().Ticks,File=file});
            } catch(InvalidOperationException) { } catch(System.ComponentModel.Win32Exception) { }
        }
        return found.OrderBy(p=>p.File,StringComparer.OrdinalIgnoreCase).ThenBy(p=>p.Id).ToList();
    }
    static string ProcessList(List<RelatedProcess> processes) {
        return string.Join("\n",processes.Take(12).Select(p=>p.ToString()))+(processes.Count>12?"\n另有 "+(processes.Count-12)+" 个进程。":"");
    }
    static void Closed(string target) {
        var remaining=RelatedProcesses(target);
        Need(remaining.Count==0,"该目录仍有相关程序运行：\n"+ProcessList(remaining)+"\n请保存任务后点击“停止相关程序”，再开始更新。");
    }
    static string ValidateTarget(string selected,Manifest manifest) {
        Need(!string.IsNullOrWhiteSpace(selected),"请选择已经安装的 XM剪辑台文件夹。");
        string target=Canonical(selected);Real(target);
        Need(target.Length > Path.GetPathRoot(target).TrimEnd('\\').Length && Directory.Exists(target), "请选择已经安装的 XM剪辑台文件夹。");
        Need(!string.Equals(Canonical(Root),target,StringComparison.OrdinalIgnoreCase) && !Inside(Canonical(Root),target),"更新包请完整解压到安装目录之外，再运行外层更新器。");
        Need(target.IndexOf("fork", StringComparison.OrdinalIgnoreCase) < 0 && target.IndexOf("kirota", StringComparison.OrdinalIgnoreCase) < 0 && !File.Exists(Child(target,"xm-fork-install.id")), "请选择原版 XM剪辑台目录，另一版本保持独立。");
        Need(File.Exists(Child(target,"xiaoma-install.id")) && File.ReadAllText(Child(target,"xiaoma-install.id")).Trim() == manifest.marker, "未找到原版安装标记。");
        return target;
    }
    static Process Reopen(RelatedProcess expected) {
        Process process=null;
        try {
            process=Process.GetProcessById(expected.Id);
            // Recheck the live handle before acting, guarding against PID reuse after a process exits.
            var module=process.MainModule;
            if(module!=null && !string.IsNullOrEmpty(module.FileName) && process.StartTime.ToUniversalTime().Ticks==expected.Started &&
                string.Equals(Canonical(module.FileName),expected.File,StringComparison.OrdinalIgnoreCase))return process;
        } catch(ArgumentException) { } catch(InvalidOperationException) { } catch(System.ComponentModel.Win32Exception) { }
        if(process!=null)process.Dispose();return null;
    }
    static bool IsAlive(RelatedProcess expected) { using(var process=Reopen(expected))return process!=null && !process.HasExited; }
    static void WaitForStopped(List<RelatedProcess> processes,int milliseconds) {
        var clock=Stopwatch.StartNew();
        while(clock.ElapsedMilliseconds<milliseconds && processes.Any(IsAlive))Thread.Sleep(100);
    }
    static string StopRelatedProcesses(string selected) {
        string target=ValidateTarget(selected,Load());var pending=RelatedProcesses(target);
        if(pending.Count==0)return "没有正在运行的相关程序，可以开始更新。";
        var seen=new HashSet<string>();
        foreach(var item in pending) {
            seen.Add(item.Id+":"+item.Started);
            using(var process=Reopen(item))if(process!=null)try{process.CloseMainWindow();}catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}
        }
        WaitForStopped(pending,3000);
        // Bounded rescans also catch a runner that was started while its local service was exiting.
        for(int attempt=0;attempt<3;attempt++) {
            pending=RelatedProcesses(target);if(pending.Count==0)break;
            foreach(var item in pending) {
                seen.Add(item.Id+":"+item.Started);
                using(var process=Reopen(item))if(process!=null)try{process.Kill();}catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}
            }
            WaitForStopped(pending,2000);
        }
        var remaining=RelatedProcesses(target);
        Need(remaining.Count==0,"以下程序未能停止（可能权限不足），请手动关闭后重试：\n"+ProcessList(remaining));
        return "已停止 "+seen.Count+" 个相关进程，可以开始更新。";
    }
    static string Apply(string selected, bool verifyOnly) {
        var manifest = Load(); string target = ValidateTarget(selected,manifest);
        string exe = Child(target,"小马剪辑台.exe");
        var version = File.Exists(exe) ? FileVersionInfo.GetVersionInfo(exe).ProductVersion : "";
        Need(manifest.baselines != null && manifest.baselines.Length > 0, "更新包缺少兼容版本清单，请重新下载。");
        Need(manifest.baselines.Any(item => version == item.version + ".0") || version == manifest.version + ".0", "此增量更新包支持原版 " + Supported(manifest) + "。旧版本请先升级到 " + manifest.baseVersion + " 完整版。");
        Closed(target);
        string payloadRoot = Path.Combine(Root,"payload");
        Need(Directory.Exists(payloadRoot), "更新包未完整解压：请让更新器 EXE 与 payload 文件夹保持在同一目录，不要单独移动 EXE。");
        foreach (var file in manifest.changed) {
            string source = Child(payloadRoot,file.name);
            Need(File.Exists(source), "更新包缺少 payload 文件：" + file.name + "。请重新解压整个 ZIP，再运行外层的更新器 EXE。");
            Verify(source,file.after);
        }
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
            try {
                Need(!(args.Contains("--stop-related") && args.Contains("--verify-only")),"仅校验模式不能同时停止进程。");
                string result=args.Contains("--stop-related")?StopRelatedProcesses(args[1]):Apply(args[1],args.Contains("--verify-only"));
                try { Console.WriteLine(result); } catch(IOException) { } return 0;
            }
            catch (Exception error) { try { Console.Error.WriteLine(error.Message); } catch(IOException) { } return 1; }
        }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        using(var form=CreateUpdaterForm(args))Application.Run(form);return 0;
    }
    static Form CreateUpdaterForm(string[] args) {
        var manifest = Load();
        var form = new Form { Text="XM剪辑台 " + manifest.version + " 增量更新包", ClientSize=new Size(590,310), StartPosition=FormStartPosition.CenterScreen, FormBorderStyle=FormBorderStyle.FixedDialog, MaximizeBox=false };
        var title = new Label { Text="支持原版 " + Supported(manifest) + "，更新至 " + manifest.version + "。请先彻底退出软件。", AutoSize=true, Location=new Point(20,20) };
        var folder = new TextBox { Location=new Point(20,54), Width=450 };
        using (var key=Registry.CurrentUser.OpenSubKey("Software\\Xiaoma\\EditingStudio")) if(key!=null) folder.Text=Convert.ToString(key.GetValue("InstallLocation"));
        if (args.Length == 2 && args[0] == "--directory") folder.Text = args[1];
        var browse = new Button { Text="选择目录", Location=new Point(480,52), Width=90 };
        var stop = new Button { Name="stopRelated", Text="停止相关程序", Location=new Point(280,102), Size=new Size(150,36) };
        var update = new Button { Text="开始更新", Location=new Point(450,102), Size=new Size(120,36) };
        var status = new Label { Text="只替换变更文件，更新前自动备份。\n若提示程序仍在运行，请先保存任务，再点击“停止相关程序”。\n将停止所选目录内的剪辑台、桌宠、本地模型服务等后台进程。", Location=new Point(20,154), Size=new Size(550,140) };
        bool busy=false;
        browse.Click += (s,e) => { using(var dialog=new FolderBrowserDialog { Description="选择已安装的原版 XM剪辑台目录", SelectedPath=folder.Text }) if(dialog.ShowDialog(form)==DialogResult.OK) folder.Text=dialog.SelectedPath; };
        stop.Click += async (s,e) => {
            string selected;
            try {
                selected=ValidateTarget(folder.Text,manifest);var pending=RelatedProcesses(selected);
                if(pending.Count==0){status.Text="没有正在运行的相关程序，可以开始更新。";return;}
                if(MessageBox.Show(form,"将停止以下目录内的相关程序：\n"+selected+"\n\n"+ProcessList(pending)+"\n\n请先保存任务。正在进行的分析、下载或导出会中断，未保存的内容可能丢失。\n正常退出后仍未结束的进程将被强制停止。是否继续？","停止相关程序",MessageBoxButtons.YesNo,MessageBoxIcon.Warning,MessageBoxDefaultButton.Button2)!=DialogResult.Yes)return;
            }catch(Exception error){MessageBox.Show(form,error.Message,"XM剪辑台",MessageBoxButtons.OK,MessageBoxIcon.Warning);return;}
            busy=true;stop.Enabled=update.Enabled=browse.Enabled=folder.Enabled=false;status.Text="正在停止相关程序，请稍候…";
            try{status.Text=await Task.Run(()=>StopRelatedProcesses(selected));}
            catch(Exception error){status.Text=error.Message;MessageBox.Show(form,error.Message,"XM剪辑台",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
            finally{busy=false;stop.Enabled=update.Enabled=browse.Enabled=folder.Enabled=true;}
        };
        update.Click += async (s,e) => {
            busy=true; stop.Enabled=update.Enabled=browse.Enabled=folder.Enabled=false; status.Text="正在校验与更新，请稍候…"; string selected=folder.Text;
            try { string result=await Task.Run(()=>Apply(selected,false)); status.Text="更新完成。"; MessageBox.Show(form,result,"XM剪辑台",MessageBoxButtons.OK,MessageBoxIcon.Information); }
            catch(Exception error) { status.Text="更新未完成。"; MessageBox.Show(form,error.Message,"XM剪辑台",MessageBoxButtons.OK,MessageBoxIcon.Warning); }
            finally { busy=false;stop.Enabled=update.Enabled=browse.Enabled=folder.Enabled=true; }
        };
        form.FormClosing += (s,e)=>{if(busy)e.Cancel=true;};
        form.Controls.AddRange(new Control[]{title,folder,browse,stop,update,status}); return form;
    }
}
