using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Diagnostics;
using System.ComponentModel;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private Dictionary<string, object> quickSettings;
        private List<object> installs = new List<object>();
        private async Task<object> AddQuickFolders(IEnumerable<string> paths) {
            string file = Path.Combine(DataDir, "quick-launch.json");
            var settings = quickSettings ?? J.Map(J.Read(file, J.Obj("folders", new object[0], "selected", "")));
            var next = new Dictionary<string, object>(settings);
            next["folders"] = QuickFolders.Merge(J.Arr(J.Get(settings,"folders")), paths);
            J.Save(file,next); quickSettings = next;
            return await QuickLaunch("status",null);
        }
        private async Task<object> QuickLaunch(string action, object value) {
            string file = Path.Combine(DataDir, "quick-launch.json");
            if (quickSettings == null) quickSettings = J.Map(J.Read(file, J.Obj("folders", new object[0], "selected", "")));
            var folders = J.Arr(J.Get(quickSettings, "folders")).ToList();
            if (action == "scan" || action == "browse") {
                if (action == "browse") using (var dialog = new OpenFileDialog { Filter = "剪映启动程序|JianyingPro.exe" }) if (dialog.ShowDialog(MainWindow) == DialogResult.OK) { quickSettings["selected"] = dialog.FileName; J.Save(file, quickSettings); }
                installs = await Task.Run(() => DiscoverJianying(J.Str(quickSettings, "selected")));
            } else if (action == "addFolder") {
                if (folders.Count >= 8) throw new Exception("最多设置八个自定义文件夹。"); var folder = ChooseFolder();
                if (folder.Length > 0) return await AddQuickFolders(new[] { folder });
            } else if (action == "removeFolder") { quickSettings["folders"] = folders.Where(x => J.Str(x, "id") != Convert.ToString(value)).ToArray(); J.Save(file, quickSettings); }
            else if (action == "openFolder") { string folder = J.Str(folders.Find(x => J.Str(x, "id") == Convert.ToString(value)), "path"); if (!Directory.Exists(folder)) throw new Exception("文件夹不存在或磁盘未连接。"); OpenPath(folder); }
            else if (action == "select") { if (!installs.Any(x => J.Str(x, "path") == Convert.ToString(value))) throw new Exception("请重新检测剪映。"); quickSettings["selected"] = value; J.Save(file, quickSettings); }
            string selected = J.Str(quickSettings, "selected"); if (!installs.Any(x => J.Str(x, "path") == selected)) selected = J.Str(installs.FirstOrDefault(), "path");
            if (action == "launch") { if (!File.Exists(selected)) { installs = await Task.Run(() => DiscoverJianying(J.Str(quickSettings, "selected"))); selected = J.Str(installs.FirstOrDefault(), "path"); } if (!File.Exists(selected)) throw new Exception("未找到剪映，请手动选择启动程序。"); OpenPath(selected); }
            bool restarted = false;
            if (action == "restart") {
                if (!File.Exists(selected) || !Path.GetFileName(selected).Equals("JianyingPro.exe", StringComparison.OrdinalIgnoreCase)) throw new Exception("未找到剪映，请重新检测或手动选择启动程序。");
                if (MessageBox.Show(MainWindow, "重启会强制关闭所有剪映窗口及相关后台进程。请先保存剪映中尚未保存的草稿。\n\n确认重启剪映？", "重启剪映", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes) {
                    await Task.Run(() => RestartJianying(selected));
                    restarted = true;
                }
            }
            return J.Obj("folders", J.Get(quickSettings, "folders"), "installs", installs, "selected", selected, "restarted", restarted);
        }
        internal static bool ShouldStopJianyingProcess(string name, string path, IEnumerable<string> roots) {
            if (string.IsNullOrEmpty(path)) return false;
            string file = Path.GetFileName(path);
            if (name == "JianyingPro" && file.Equals("JianyingPro.exe", StringComparison.OrdinalIgnoreCase)) return true;
            if (name == "JianyingProTray" && file.Equals("JianyingProTray.exe", StringComparison.OrdinalIgnoreCase)) return true;
            return name == "VEDetector" && file.Equals("VEDetector.exe", StringComparison.OrdinalIgnoreCase)
                && roots.Any(root => path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase));
        }
        private static void RestartJianying(string executable) {
            var roots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            Action<string> addRoot = path => {
                string directory = Path.GetDirectoryName(Path.GetFullPath(path));
                roots.Add(directory);
                if (Regex.IsMatch(Path.GetFileName(directory), @"^\d+(\.\d+){1,5}$")) roots.Add(Path.GetDirectoryName(directory));
            };
            addRoot(executable);
            foreach (var process in Process.GetProcessesByName("JianyingPro")) using (process) {
                try { if (!process.HasExited) addRoot(process.MainModule.FileName); }
                catch (InvalidOperationException) {}
                catch (Win32Exception) { throw new Exception("无法确认剪映进程路径，请手动退出剪映后重试。"); }
            }
            foreach (string name in new[] { "JianyingProTray", "JianyingPro", "VEDetector" }) {
                foreach (var process in Process.GetProcessesByName(name)) using (process) {
                    try {
                        if (process.HasExited || !ShouldStopJianyingProcess(name, process.MainModule.FileName, roots)) continue;
                        process.Kill();
                        if (!process.WaitForExit(5000)) throw new Exception("剪映进程未能退出，请手动关闭后重试。");
                    } catch (InvalidOperationException) {}
                    catch (Win32Exception) { throw new Exception("无法结束剪映进程，请以相同权限运行剪辑台或手动退出剪映。"); }
                }
            }
            foreach (string name in new[] { "JianyingProTray", "JianyingPro", "VEDetector" }) {
                foreach (var process in Process.GetProcessesByName(name)) using (process) {
                    try { if (!process.HasExited && ShouldStopJianyingProcess(name, process.MainModule.FileName, roots)) throw new Exception("剪映仍有后台进程运行，请手动关闭后重试。"); }
                    catch (InvalidOperationException) {}
                    catch (Win32Exception) { throw new Exception("无法确认剪映后台进程已退出，请手动检查后重试。"); }
                }
            }
            Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(executable) });
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
