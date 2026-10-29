using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Diagnostics;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private Dictionary<string, object> quickSettings;
        private List<object> installs = new List<object>();
        private async Task<object> QuickLaunch(string action, object value) {
            string file = Path.Combine(DataDir, "quick-launch.json");
            if (quickSettings == null) quickSettings = J.Map(J.Read(file, J.Obj("folders", new object[0], "selected", "")));
            var folders = J.Arr(J.Get(quickSettings, "folders")).ToList();
            if (action == "scan" || action == "browse") {
                if (action == "browse") using (var dialog = new OpenFileDialog { Filter = "剪映启动程序|JianyingPro.exe" }) if (dialog.ShowDialog(MainWindow) == DialogResult.OK) { quickSettings["selected"] = dialog.FileName; J.Save(file, quickSettings); }
                installs = await Task.Run(() => DiscoverJianying(J.Str(quickSettings, "selected")));
            } else if (action == "addFolder") {
                if (folders.Count >= 8) throw new Exception("最多设置八个自定义文件夹。"); var folder = ChooseFolder();
                if (folder.Length > 0 && !folders.Any(x => J.Str(x, "path").Equals(folder, StringComparison.OrdinalIgnoreCase))) folders.Add(J.Obj("id", Guid.NewGuid().ToString("N"), "path", folder, "name", Path.GetFileName(folder)));
                quickSettings["folders"] = folders; J.Save(file, quickSettings);
            } else if (action == "removeFolder") { quickSettings["folders"] = folders.Where(x => J.Str(x, "id") != Convert.ToString(value)).ToArray(); J.Save(file, quickSettings); }
            else if (action == "openFolder") { string folder = J.Str(folders.Find(x => J.Str(x, "id") == Convert.ToString(value)), "path"); if (!Directory.Exists(folder)) throw new Exception("文件夹不存在或磁盘未连接。"); OpenPath(folder); }
            else if (action == "select") { if (!installs.Any(x => J.Str(x, "path") == Convert.ToString(value))) throw new Exception("请重新检测剪映。"); quickSettings["selected"] = value; J.Save(file, quickSettings); }
            string selected = J.Str(quickSettings, "selected"); if (!installs.Any(x => J.Str(x, "path") == selected)) selected = J.Str(installs.FirstOrDefault(), "path");
            if (action == "launch") { if (!File.Exists(selected)) { installs = await Task.Run(() => DiscoverJianying(J.Str(quickSettings, "selected"))); selected = J.Str(installs.FirstOrDefault(), "path"); } if (!File.Exists(selected)) throw new Exception("未找到剪映，请手动选择启动程序。"); OpenPath(selected); }
            return J.Obj("folders", J.Get(quickSettings, "folders"), "installs", installs, "selected", selected);
        }
        private static List<object> DiscoverJianying(string selected) {
            var roots = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JianyingPro"), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "JianyingPro") };
            if (!string.IsNullOrEmpty(selected)) roots.Add(selected);
            foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine }) {
                try { using (var key = hive.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\JianyingPro.exe")) if (key != null) roots.Add(Convert.ToString(key.GetValue(""))); } catch {}
                foreach (string branch in new[] { @"Software\Microsoft\Windows\CurrentVersion\Uninstall", @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" }) try {
                    using (var key = hive.OpenSubKey(branch)) if (key != null) foreach (var name in key.GetSubKeyNames()) using (var item = key.OpenSubKey(name)) if (item != null && Regex.IsMatch(Convert.ToString(item.GetValue("DisplayName")), "剪映|jianying", RegexOptions.IgnoreCase)) {
                        foreach (var field in new[] { "InstallLocation", "DisplayIcon" }) { var path = Convert.ToString(item.GetValue(field)).Trim('"').Split(',')[0]; if (Path.IsPathRooted(path)) roots.Add(path); }
                    }
                } catch {}
            }
            foreach (var drive in DriveInfo.GetDrives()) { try { if (!drive.IsReady || drive.DriveType != DriveType.Fixed) continue; foreach (var dir in Directory.GetDirectories(drive.RootDirectory.FullName)) if (Regex.IsMatch(Path.GetFileName(dir), "jianying|剪映|program files|programs|apps|software|软件|应用", RegexOptions.IgnoreCase)) roots.Add(dir); } catch {} }
            var pending = new Queue<Tuple<string, int>>(roots.Select(x => Tuple.Create(x, 0))); var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase); int visited = 0;
            while (pending.Count > 0 && ++visited < 1200) { var next = pending.Dequeue(); try {
                string exe = File.Exists(next.Item1) ? next.Item1 : Path.Combine(next.Item1, "JianyingPro.exe"); if (File.Exists(exe) && Path.GetFileName(exe).Equals("JianyingPro.exe", StringComparison.OrdinalIgnoreCase)) found.Add(exe);
                if (next.Item2 >= 3 || !Directory.Exists(next.Item1)) continue;
                foreach (var dir in Directory.GetDirectories(next.Item1).Take(200)) if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) == 0 && Regex.IsMatch(Path.GetFileName(dir), @"jianying|剪映|bytedance|^(apps|application|programs|\d+(\.\d+){1,5})$", RegexOptions.IgnoreCase)) pending.Enqueue(Tuple.Create(dir, next.Item2 + 1));
            } catch {} }
            return found.OrderByDescending(x => x).Select(x => (object)J.Obj("path", x, "name", "剪映专业版", "version", Path.GetFileName(Path.GetDirectoryName(x)), "modifiedAt", J.Now())).ToList();
        }
    }
}
