using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace XM.Native {
    internal static class DropFiles {
        internal static readonly string[] VideoExtensions = { ".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm" };
        internal static string[] Expand(IEnumerable<string> paths) {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var queue = new Queue<string>(paths);
            int visited = 0;
            while (queue.Count > 0) {
                if (++visited > 50000) throw new IOException("文件夹内容过多，请选择更小的子文件夹。");
                string path = queue.Dequeue();
                if (!Path.IsPathRooted(path) || !File.Exists(path) && !Directory.Exists(path)) throw new IOException("拖入的文件已不存在。");
                if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) continue;
                if (Directory.Exists(path)) { foreach (string entry in Directory.GetFileSystemEntries(path)) queue.Enqueue(entry); continue; }
                if (!VideoExtensions.Concat(new[] { ".srt", ".ass", ".mp3", ".wav" }).Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase)) continue;
                if (System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(path), @"样片(?: \(\d+\))?\.mp4$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) continue;
                result.Add(Path.GetFullPath(path));
                if (result.Count > 2000) throw new IOException("一次最多处理 2000 个素材，请分批拖入。");
            }
            return result.OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToArray();
        }
    }
}
