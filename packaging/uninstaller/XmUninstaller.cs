using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal sealed class XmInstallation
{
    internal string Path;
    internal string Version;
    internal bool Registered;
    internal List<string> Files;
}

internal static class XmInstallations
{
    private const string Marker = "xiaoma-editing-studio-482e9a36-9698-45e1-b24e-d2e8d9042885";
    private const string ProductKey = @"SoftwareXiaomaEditingStudio";
    private const string UninstallKey = @"SoftwareMicrosoftWindowsCurrentVersionUninstallXiaomaEditingStudio";
    private static readonly string[] CommonNames = { "小马剪辑台", "XM剪辑台", "XM-Editing-Studio" };
    private static readonly HashSet<string> RootFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "小马剪辑台.exe", "app-icon.ico", "Microsoft.Web.WebView2.Core.dll",
        "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll", "WebView2-LICENSE.txt",
        "WebView2-NOTICE.txt", "THIRD_PARTY_NOTICES.txt"
    };

    internal static string RegisteredPath()
    {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(ProductKey))
            return key == null ? null : key.GetValue("InstallLocation") as string;
    }

    private static bool SamePath(string a, string b)
    {
        if (String.IsNullOrWhiteSpace(a) || String.IsNullOrWhiteSpace(b)) return false;
        try { return String.Equals(System.IO.Path.GetFullPath(a).TrimEnd('\\'), System.IO.Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    private static void CheckDirectory(string directory)
    {
        string full = System.IO.Path.GetFullPath(directory).TrimEnd('\\');
        if (full.Length == 0 || SamePath(full, System.IO.Path.GetPathRoot(full))) throw new IOException("不能选择磁盘根目录。");
        if (full.Split('\\').Any(part => part.IndexOf("fork", StringComparison.OrdinalIgnoreCase) >= 0 || part.IndexOf("kirota", StringComparison.OrdinalIgnoreCase) >= 0))
            throw new IOException("此工具不处理 fork 版目录。");
        for (string current = full; !String.IsNullOrEmpty(current); current = System.IO.Path.GetDirectoryName(current))
        {
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("安装路径包含链接或重解析点，已停止操作。");
            if (SamePath(current, System.IO.Path.GetPathRoot(current))) break;
        }
        if (File.Exists(System.IO.Path.Combine(full, "xm-fork-install.id")) || File.Exists(System.IO.Path.Combine(full, "XM剪辑台-Fork.exe")))
            throw new IOException("检测到 fork 版标记，已停止操作。");
    }

    private static string ManagedFile(string root, string relative)
    {
        if (String.IsNullOrWhiteSpace(relative) || relative.IndexOf(':') >= 0 || relative.StartsWith("/") || relative.StartsWith("\\"))
            throw new IOException("程序清单含无效路径。");
        string[] parts = relative.Replace('\\', '/').Split('/');
        if (parts.Any(part => part.Length == 0 || part == "." || part == ".." || part.TrimEnd(' ', '.') != part))
            throw new IOException("程序清单含越界路径。");
        if (parts[0].Equals("data", StringComparison.OrdinalIgnoreCase) || parts[0].Equals(".xiaoma-update-backups", StringComparison.OrdinalIgnoreCase))
            throw new IOException("程序清单包含用户数据目录，已停止操作。");
        if (parts.Length > 1 && !parts[0].Equals("resources", StringComparison.OrdinalIgnoreCase))
            throw new IOException("程序清单包含未知目录，已停止操作。");
        if (parts.Length == 1 && !RootFiles.Contains(parts[0]) && parts[0] != "native-files.json" &&
            parts[0] != "xiaoma-install.id" && parts[0] != "卸载XM剪辑台.exe")
            throw new IOException("程序清单包含未知的根目录文件，已停止操作。");
        string current = root;
        foreach (string part in parts)
        {
            current = System.IO.Path.Combine(current, part);
            if (File.Exists(current) || Directory.Exists(current))
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("程序文件路径包含链接：" + relative);
        }
        return current;
    }

    internal static XmInstallation Inspect(string directory)
    {
        string root = System.IO.Path.GetFullPath(directory).TrimEnd('\\');
        CheckDirectory(root);
        if (File.ReadAllText(System.IO.Path.Combine(root, "xiaoma-install.id")).Trim() != Marker)
            throw new IOException("缺少原版 XM剪辑台安装标记。");
        if (!File.Exists(ManagedFile(root, "小马剪辑台.exe"))) throw new IOException("找不到主程序。");
        string manifestFile = ManagedFile(root, "native-files.json");
        if (new FileInfo(manifestFile).Length > 4 * 1024 * 1024) throw new IOException("程序清单过大。");
        var json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
        var manifest = json.DeserializeObject(File.ReadAllText(manifestFile)) as IDictionary<string, object>;
        if (manifest == null || Convert.ToString(manifest["architecture"]) != "csharp-webview2")
            throw new IOException("不是受支持的 C# 版安装目录。");
        var listed = manifest["files"] as IDictionary<string, object>;
        if (listed == null || listed.Count == 0 || listed.Count > 20000 || !listed.ContainsKey("小马剪辑台.exe"))
            throw new IOException("程序清单缺失或不完整。");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string name in listed.Keys)
        {
            ManagedFile(root, name);
            if (!names.Add(name.Replace('\\', '/'))) throw new IOException("程序清单包含重复路径。");
        }
        return new XmInstallation { Path = root, Version = Convert.ToString(manifest["version"]), Registered = SamePath(root, RegisteredPath()), Files = names.ToList() };
    }

    internal static List<XmInstallation> Scan()
    {
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!String.IsNullOrWhiteSpace(RegisteredPath())) paths.Add(RegisteredPath());
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (string name in CommonNames) paths.Add(System.IO.Path.Combine(local, "Programs", name));
        foreach (DriveInfo drive in DriveInfo.GetDrives())
        {
            try
            {
                if (!drive.IsReady || (drive.DriveType != DriveType.Fixed && drive.DriveType != DriveType.Removable)) continue;
                foreach (string name in CommonNames) paths.Add(System.IO.Path.Combine(drive.RootDirectory.FullName, name));
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        var found = new List<XmInstallation>();
        foreach (string path in paths)
        {
            try { if (Directory.Exists(path)) found.Add(Inspect(path)); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            catch (ArgumentException) { }
            catch (KeyNotFoundException) { }
        }
        return found.OrderBy(x => x.Path).ToList();
    }

    private static void CheckClosed(XmInstallation install)
    {
        foreach (string relative in install.Files.Where(name => name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)))
        {
            string file = ManagedFile(install.Path, relative);
            if (!File.Exists(file)) continue;
            try { using (FileStream unused = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } }
            catch (IOException) { throw new IOException("有程序文件正在使用，请从托盘彻底退出 XM剪辑台和相关引擎后重试：" + relative); }
            catch (UnauthorizedAccessException) { throw new IOException("没有权限访问程序文件：" + relative); }
        }
    }

    internal static bool IsRunning(XmInstallation install)
    {
        string file = ManagedFile(install.Path, "小马剪辑台.exe");
        try { using (FileStream unused = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } return false; }
        catch (IOException) { return true; }
        catch (UnauthorizedAccessException) { return true; }
    }

    private static void RemoveShortcut(string file, string expectedTarget)
    {
        if (!File.Exists(file)) return;
        object shell = null;
        object shortcut = null;
        try
        {
            Type type = Type.GetTypeFromProgID("WScript.Shell");
            if (type == null) return;
            shell = Activator.CreateInstance(type);
            shortcut = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { file });
            string target = Convert.ToString(shortcut.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null));
            if (SamePath(target, expectedTarget)) File.Delete(file);
        }
        catch (Exception) { } // Do not delete a shortcut whose target cannot be verified.
        finally
        {
            if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.ReleaseComObject(shortcut);
            if (shell != null && Marshal.IsComObject(shell)) Marshal.ReleaseComObject(shell);
        }
    }

    internal static string Uninstall(XmInstallation selected, bool archiveData = false)
    {
        XmInstallation install = Inspect(selected.Path);
        if (!new HashSet<string>(install.Files, StringComparer.OrdinalIgnoreCase).SetEquals(selected.Files))
            throw new IOException("安装文件清单已变化，请重新扫描后再卸载。");
        CheckClosed(install);
        var failures = new List<string>();
        var directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string relative in install.Files)
        {
            try
            {
                string file = ManagedFile(install.Path, relative);
                if (File.Exists(file)) File.Delete(file);
                string parent = System.IO.Path.GetDirectoryName(file);
                while (!SamePath(parent, install.Path))
                {
                    directories.Add(parent);
                    parent = System.IO.Path.GetDirectoryName(parent);
                }
            }
            catch (IOException error) { failures.Add(relative + "：" + error.Message); }
            catch (UnauthorizedAccessException error) { failures.Add(relative + "：" + error.Message); }
        }
        if (failures.Count > 0)
            throw new IOException("部分程序文件未能移除。安装标记和注册信息已保留，可退出程序后重试。\n" + String.Join("\n", failures.Take(5)));
        string dataBackup = null;
        if (archiveData)
        {
            string data = System.IO.Path.Combine(install.Path, "data");
            if (Directory.Exists(data))
            {
                if ((File.GetAttributes(data) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("data 是链接目录，无法安全移动。");
                string parent = System.IO.Path.GetDirectoryName(install.Path);
                dataBackup = System.IO.Path.Combine(parent, System.IO.Path.GetFileName(install.Path) + "-data-backup-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                Directory.Move(data, dataBackup);
            }
        }
        foreach (string dir in directories.OrderByDescending(x => x.Length))
        {
            try { if (Directory.Exists(dir)) Directory.Delete(dir); }
            catch (IOException) { } // Nonempty directories contain user or unlisted files.
            catch (UnauthorizedAccessException) { }
        }
        string nativeUninstaller = ManagedFile(install.Path, "卸载XM剪辑台.exe");
        if (File.Exists(nativeUninstaller) && FileVersionInfo.GetVersionInfo(nativeUninstaller).ProductName == "XM剪辑台") File.Delete(nativeUninstaller);
        if (install.Registered)
        {
            if (!SamePath(install.Path, RegisteredPath())) throw new IOException("安装注册信息已变化，已保留注册表和安装标记。请重新扫描。");
            string shortcuts = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "XM剪辑台");
            RemoveShortcut(System.IO.Path.Combine(shortcuts, "XM剪辑台.lnk"), System.IO.Path.Combine(install.Path, "小马剪辑台.exe"));
            RemoveShortcut(System.IO.Path.Combine(shortcuts, "使用说明.lnk"), System.IO.Path.Combine(install.Path, "使用说明.txt"));
            RemoveShortcut(System.IO.Path.Combine(shortcuts, "卸载.lnk"), nativeUninstaller);
            RemoveShortcut(System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "XM剪辑台.lnk"), System.IO.Path.Combine(install.Path, "小马剪辑台.exe"));
            try { Directory.Delete(shortcuts); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(UninstallKey))
            {
                if (key != null && SamePath(key.GetValue("InstallLocation") as string, install.Path))
                    Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
            }
            Registry.CurrentUser.DeleteSubKeyTree(ProductKey, false);
        }
        File.Delete(ManagedFile(install.Path, "native-files.json"));
        File.Delete(ManagedFile(install.Path, "xiaoma-install.id"));
        try { Directory.Delete(install.Path); } catch (IOException) { } // Preserve personal data and unrelated files.
        return "程序文件已卸载。" + (dataBackup == null ? "data 仍在原安装目录。" : "旧 data 已移至：\n" + dataBackup + "\n") + "备份及其他个人文件已保留。";
    }
}

internal sealed class XmUninstallerForm : Form
{
    private readonly ListView installations = new ListView();
    private readonly Button remove = new Button();
    private readonly Label state = new Label();
    private readonly CheckBox archive = new CheckBox();

    internal XmUninstallerForm()
    {
        Text = "XM剪辑台卸载工具";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(660, 340);
        Size = new Size(820, 420);
        Font = new Font("Microsoft YaHei UI", 9F);
        BackColor = Color.FromArgb(247, 249, 250);
        var heading = new Label { Text = "检测并卸载 XM剪辑台", Dock = DockStyle.Top, Height = 62, Padding = new Padding(20, 17, 0, 0), Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Bold) };
        var note = new Label { Text = "仅识别有原版安装标记和文件清单的目录。卸载保留剧本、音乐、模型、个人配置和备份。", Dock = DockStyle.Top, Height = 38, Padding = new Padding(20, 5, 0, 0) };
        installations.Dock = DockStyle.Fill;
        installations.View = View.Details;
        installations.FullRowSelect = true;
        installations.HideSelection = false;
        installations.MultiSelect = false;
        installations.Columns.Add("安装目录", 430);
        installations.Columns.Add("版本", 76);
        installations.Columns.Add("来源", 95);
        installations.Columns.Add("状态", 90);
        installations.SelectedIndexChanged += (sender, args) => remove.Enabled = installations.SelectedItems.Count == 1;
        var actions = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 55, Padding = new Padding(16, 9, 12, 0) };
        archive.Text = "将旧 data 移到安装目录旁备份（解决旧数据迁移失败；默认保留原位置）";
        archive.Dock = DockStyle.Bottom;
        archive.Height = 32;
        archive.Padding = new Padding(20, 0, 0, 0);
        var scan = new Button { Text = "重新扫描", Width = 110, Height = 34 };
        var browse = new Button { Text = "选择文件夹...", Width = 130, Height = 34 };
        remove.Text = "卸载所选版本";
        remove.Width = 145;
        remove.Height = 34;
        remove.Enabled = false;
        scan.Click += (sender, args) => RefreshList();
        browse.Click += (sender, args) => Browse();
        remove.Click += (sender, args) => RemoveSelected();
        actions.Controls.Add(scan);
        actions.Controls.Add(browse);
        actions.Controls.Add(remove);
        state.Dock = DockStyle.Bottom;
        state.Height = 35;
        state.Padding = new Padding(20, 6, 0, 0);
        Controls.Add(installations);
        Controls.Add(state);
        Controls.Add(actions);
        Controls.Add(archive);
        Controls.Add(note);
        Controls.Add(heading);
        Shown += (sender, args) => RefreshList();
    }

    private void Add(XmInstallation item)
    {
        var row = new ListViewItem(new[] { item.Path, item.Version, item.Registered ? "已注册安装" : "独立安装", XmInstallations.IsRunning(item) ? "运行或占用" : "可卸载" });
        row.Tag = item;
        installations.Items.Add(row);
    }

    private void RefreshList()
    {
        installations.Items.Clear();
        foreach (XmInstallation item in XmInstallations.Scan()) Add(item);
        state.Text = installations.Items.Count == 0 ? "未检测到原版安装。可以手动选择安装目录。" : "检测到 " + installations.Items.Count + " 个原版安装目录。";
    }

    private void Browse()
    {
        using (var picker = new FolderBrowserDialog { Description = "选择 XM剪辑台原版安装目录", ShowNewFolderButton = false })
        {
            if (picker.ShowDialog(this) != DialogResult.OK) return;
            try
            {
                XmInstallation item = XmInstallations.Inspect(picker.SelectedPath);
                foreach (ListViewItem row in installations.Items)
                    if (String.Equals(((XmInstallation)row.Tag).Path, item.Path, StringComparison.OrdinalIgnoreCase)) { row.Selected = true; row.EnsureVisible(); return; }
                Add(item);
                installations.Items[installations.Items.Count - 1].Selected = true;
            }
            catch (Exception error) { MessageBox.Show(this, error.Message, "无法识别安装", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }
    }

    private async void RemoveSelected()
    {
        if (installations.SelectedItems.Count != 1) return;
        XmInstallation item = (XmInstallation)installations.SelectedItems[0].Tag;
        bool moveData = archive.Checked;
        string message = "确定卸载此目录中的 XM剪辑台 " + item.Version + " 吗？\n\n" + item.Path +
                         "\n\n将移除清单中的 " + item.Files.Count + " 个程序文件。" +
                         (moveData ? "旧 data 将移到安装目录旁的备份，不会删除内容。" : "data 会留在原位置。") +
                         "其他个人文件和备份保留；fork 版不受影响。请先彻底退出剪辑台。";
        if (MessageBox.Show(this, message, "确认卸载", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        Enabled = false;
        state.Text = "正在卸载 " + item.Path + " ...";
        try
        {
            string result = await System.Threading.Tasks.Task.Run(() => XmInstallations.Uninstall(item, moveData));
            RefreshList();
            MessageBox.Show(this, result, "卸载完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception error) { state.Text = "卸载未完成，请检查提示。"; MessageBox.Show(this, error.Message, "卸载未完成", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        finally { Enabled = true; }
    }
}

internal static class Program
{
    [STAThread]
    private static void Main()
    {
#if UNINSTALL_TEST
        string[] args = Environment.GetCommandLineArgs();
        if (args.Length == 3)
        {
            try
            {
                XmInstallation found = XmInstallations.Inspect(args[2]);
                if (args[1] == "--inspect") { Console.WriteLine(found.Path + "|" + found.Version + "|" + found.Files.Count); return; }
                if (args[1] == "--remove-test") { Console.WriteLine(XmInstallations.Uninstall(found)); return; }
                if (args[1] == "--archive-test") { Console.WriteLine(XmInstallations.Uninstall(found, true)); return; }
            }
            catch (Exception error) { Console.Error.WriteLine(error.Message); Environment.ExitCode = 1; return; }
        }
        if (args.Length == 2 && args[1] == "--scan")
        {
            foreach (XmInstallation item in XmInstallations.Scan()) Console.WriteLine(item.Path + "|" + item.Version);
            return;
        }
#endif
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new XmUninstallerForm());
    }
}
