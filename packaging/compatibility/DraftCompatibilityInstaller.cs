using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Installs only the optional local DraftIO runtime; never replaces Jianying,
// XM binaries, settings or drafts. The manifest is embedded at build time.
internal static class DraftCompatibilityInstaller
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
    private static IDictionary Manifest() {
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("runtime-spec.json"))
        using (var reader = new StreamReader(stream, Encoding.UTF8)) return (IDictionary)Json.DeserializeObject(reader.ReadToEnd());
    }
    private static string Hash(string file) { using (var stream = File.OpenRead(file)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
    private static string Inside(string root, string child) {
        string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string full = Path.GetFullPath(Path.Combine(prefix, child));
        if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("目标超出安装目录。");
        for (var dir = new DirectoryInfo(Path.GetDirectoryName(full)); dir != null; dir = dir.Parent)
            if (dir.Exists && (dir.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("请选择真实目录，不能使用目录链接。");
        return full;
    }
    private static IEnumerable<string> Names(IDictionary manifest) {
        var files = manifest["files"] as IDictionary;
        if (files == null || files.Count == 0 || files.Count > 300 || !files.Contains("videoeditor.dll")) throw new IOException("兼容组件清单无效。");
        foreach (DictionaryEntry pair in files) {
            string name = Convert.ToString(pair.Key);
            if (string.IsNullOrEmpty(name) || name != Path.GetFileName(name) || name.IndexOfAny(new[] {'/', '\\', ':'}) >= 0) throw new IOException("组件文件名无效。");
            yield return name;
        }
    }
    private static void Verify(string root, IDictionary manifest) {
        var files = (IDictionary)manifest["files"];
        foreach (string name in Names(manifest)) {
            string path = Inside(root, name); var expected = (IDictionary)files[name]; var file = new FileInfo(path);
            if (!file.Exists || (file.Attributes & FileAttributes.ReparsePoint) != 0 || file.Length != Convert.ToInt64(expected["size"]) ||
                !Hash(path).Equals(Convert.ToString(expected["sha256"]), StringComparison.OrdinalIgnoreCase))
                throw new IOException("组件缺失或校验失败：" + name + "。请完整解压，勿只运行安装工具。");
        }
    }
    private static string Install(string source, string target, IDictionary manifest) {
        target = Path.GetFullPath(target);
        string marker = Inside(target, "native-files.json");
        if (!File.Exists(marker)) throw new IOException("请选择 XM剪辑台安装目录，不是剪映安装目录。");
        var installed = Json.DeserializeObject(File.ReadAllText(marker, Encoding.UTF8)) as IDictionary;
        if (installed == null || Convert.ToString(installed["architecture"]) != "csharp-webview2" || !File.Exists(Inside(target, "resources/jianying/JianYingEngine.exe")))
            throw new IOException("此组件包适用于 C# 版 XM剪辑台（1.4.2 及以后）。旧版请先更新 XM剪辑台。");
        string version = Convert.ToString(manifest["version"]);
        if (version != "11.6.5.14523") throw new IOException("不支持的兼容组件版本。");
        Verify(source, manifest);
        string destination = Inside(target, "data/draft-compat/" + version);
        if (Directory.Exists(destination)) {
            try {
                Verify(destination, manifest);
                // A complete directory without a manifest still needs normalization.
                string existing = Path.Combine(destination, "runtime.json");
                if (File.Exists(existing) && Json.Serialize(Json.DeserializeObject(File.ReadAllText(existing,Encoding.UTF8))) == Json.Serialize(manifest)) return "兼容组件已完整安装，无需重复操作。";
            } catch (IOException) { } catch (ArgumentException) { }
        }
        string stage = Inside(target, "data/draft-compat/.preparing-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(stage);
        foreach (string name in Names(manifest)) File.Copy(Inside(source,name),Inside(stage,name),false);
        File.WriteAllText(Inside(stage,"runtime.json"),Json.Serialize(manifest),new UTF8Encoding(false));
        Verify(stage,manifest);
        string backup = null;
        if (Directory.Exists(destination)) {
            backup = Inside(target, ".xiaoma-update-backups/字幕兼容组件-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.GetDirectoryName(backup)); Directory.Move(destination,backup);
        }
        try { Directory.Move(stage,destination); }
        catch { if (backup != null && !Directory.Exists(destination)) Directory.Move(backup,destination); throw; }
        return "字幕兼容组件安装完成。重新打开 XM剪辑台后提取字幕；剪映可继续使用 11.7.5。";
    }
    [STAThread]
    public static int Main(string[] args) {
        try {
            var manifest = Manifest(); string source = Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"runtime");
            if (args.Length == 1 && args[0] == "--verify") { Verify(source,manifest); Console.WriteLine("Compatibility payload verified: " + Names(manifest).Count()); return 0; }
#if COMPAT_TEST
            if (args.Length == 2 && args[0] == "--install-test") { Console.WriteLine(Install(source,args[1],manifest)); return 0; }
#endif
            Application.EnableVisualStyles();
            using (var choose = new FolderBrowserDialog { Description = "选择 XM剪辑台安装目录（例如 E:\\小马剪辑台），安装字幕兼容组件。", ShowNewFolderButton = false }) {
                if (choose.ShowDialog() != DialogResult.OK) return 0;
                Cursor.Current = Cursors.WaitCursor;
                string message;
                try { message=Install(source,choose.SelectedPath,manifest); } finally { Cursor.Current=Cursors.Default; }
                MessageBox.Show(message,"字幕兼容组件",MessageBoxButtons.OK,MessageBoxIcon.Information);
            }
            return 0;
        } catch (Exception error) {
            if (args.Length > 0) Console.Error.WriteLine(error.Message);
            else MessageBox.Show(error.Message,"未安装字幕兼容组件",MessageBoxButtons.OK,MessageBoxIcon.Error);
            return 1;
        }
    }
}
