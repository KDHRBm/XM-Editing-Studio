using System;
using System.IO;
using System.Linq;

namespace XM.Native {
    internal static class DataPaths {
        internal static string Resolve(string install, string explicitProfile) {
            if (!string.IsNullOrWhiteSpace(explicitProfile)) return Prepare(Path.GetFullPath(explicitProfile));
            string target = Path.Combine(Path.GetFullPath(install), "data");
            if (!Directory.Exists(target)) {
                string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                string legacy = new[] { "xiaoma-editing-studio", "黑曜信号台" }.Select(x => Path.Combine(roaming, x)).FirstOrDefault(Directory.Exists);
                if (legacy != null && File.Exists(Path.Combine(legacy, "companion-updates", "active.json"))) throw new IOException("请运行 1.4.2 更新包迁移已独立更新的桌宠及配置，原数据仍保留。");
                if (legacy != null && Directory.Exists(Path.Combine(legacy, "native-webview"))) {
                    string stage = target + ".migrate-" + Guid.NewGuid().ToString("N");
                    CopyProfile(legacy, stage);
                    File.WriteAllText(Path.Combine(stage, "profile-relocated.txt"), DateTime.UtcNow.ToString("o"));
                    Directory.Move(stage, target);
                } else if (legacy != null && Directory.Exists(Path.Combine(legacy, "Local Storage"))) {
                    throw new IOException("检测到旧版数据，请运行 1.4.2 更新程序迁移后启动，原数据仍保留。");
                }
            }
            return Prepare(target);
        }
        internal static string Prepare(string profile) {
            Directory.CreateDirectory(profile);
            string probe = Path.Combine(profile, ".write-test-" + Guid.NewGuid().ToString("N"));
            File.WriteAllText(probe, ""); File.Delete(probe);
            string temp = Path.Combine(profile, "cache", "temp"); Directory.CreateDirectory(temp);
            Environment.SetEnvironmentVariable("TEMP", temp); Environment.SetEnvironmentVariable("TMP", temp);
            Environment.SetEnvironmentVariable("XM_INSTALL_DATA", profile);
            Environment.SetEnvironmentVariable("QT_SHADER_CACHE_PATH", Path.Combine(profile, "cache", "qt-shaders"));
            Environment.SetEnvironmentVariable("QML_DISK_CACHE_PATH", Path.Combine(profile, "cache", "qml"));
            return profile;
        }
        internal static void CopyProfile(string source, string target) {
            if ((File.GetAttributes(source) & FileAttributes.ReparsePoint) != 0) throw new IOException("数据目录不能是链接，请选择真实目录。");
            Directory.CreateDirectory(target);
            foreach (string file in Directory.GetFiles(source)) {
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0 || Path.GetFileName(file).StartsWith("Singleton", StringComparison.OrdinalIgnoreCase)) continue;
                File.Copy(file, Path.Combine(target, Path.GetFileName(file)), false);
            }
            foreach (string dir in Directory.GetDirectories(source)) {
                string name = Path.GetFileName(dir);
                if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0 || new[] { "Cache", "Code Cache", "GPUCache", "DawnCache", "Crashpad", "cache", "updates", "companion-updates" }.Contains(name, StringComparer.OrdinalIgnoreCase)) continue;
                CopyProfile(dir, Path.Combine(target, name));
            }
        }
    }
}
