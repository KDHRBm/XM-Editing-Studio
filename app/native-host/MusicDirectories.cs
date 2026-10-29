using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;

namespace XM.Native {
    internal static class MusicDirectories {
        internal static List<string> Merge(IEnumerable<string> existing, IEnumerable<string> dropped) {
            var incoming = dropped.ToArray();
            if (incoming.Length == 0) throw new IOException("未取得文件夹，请从资源管理器拖入音乐文件夹。");
            if (incoming.Length > 20) throw new IOException("一次最多拖入 20 个音乐文件夹。");
            var result = existing.Select(Normalize).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            foreach (string item in incoming) {
                var folder = Normalize(item);
                if (!Directory.Exists(folder)) throw new IOException("请拖入音乐文件夹；文件夹中的音乐和子目录会自动扫描。");
                for (var at = new DirectoryInfo(folder); at != null; at = at.Parent)
                    if ((at.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("请选择真实音乐文件夹，不能连接目录链接。");
                if (!result.Contains(folder, StringComparer.OrdinalIgnoreCase)) result.Add(folder);
            }
            if (result.Count > 20) throw new IOException("最多连接 20 个音乐文件夹，请先断开不需要的目录。");
            return result;
        }
        private static string Normalize(string folder) {
            if (string.IsNullOrWhiteSpace(folder) || !Path.IsPathRooted(folder)) throw new IOException("音乐文件夹路径无效。");
            string full = Path.GetFullPath(folder), root = Path.GetPathRoot(full);
            return full.Length > root.Length ? full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) : full;
        }
    }
}
