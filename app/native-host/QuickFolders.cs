using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;

namespace XM.Native {
    internal static class QuickFolders {
        private static string Normalize(string path) {
            if (string.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path) || Path.GetPathRoot(path).Length < 2 || (path.Length > 1 && path[1] == ':' && (path.Length < 3 || (path[2] != '\\' && path[2] != '/'))))
                throw new IOException("请从资源管理器拖入完整的文件夹。");
            string full = Path.GetFullPath(path), root = Path.GetPathRoot(full);
            return full.Length > root.Length ? full.TrimEnd('\\', '/') : full;
        }
        internal static object[] Merge(IEnumerable<object> existing, IEnumerable<string> incoming) {
            var paths = incoming.ToArray();
            if (paths.Length == 0) throw new IOException("未取得文件夹，请从资源管理器拖入。");
            if (paths.Length > 128) throw new IOException("最多设置八个自定义文件夹，请分批选择。");
            var result = existing.ToList();
            var known = new HashSet<string>(result.Select(item => Normalize(J.Str(item,"path"))),StringComparer.OrdinalIgnoreCase);
            foreach (string path in paths) {
                string folder = Normalize(path);
                if (!Directory.Exists(folder)) throw new IOException("请拖入文件夹，不能添加普通文件或已删除的目录。");
                if (!known.Add(folder)) continue;
                string name = Path.GetFileName(folder.TrimEnd('\\','/'));
                result.Add(J.Obj("id",Guid.NewGuid().ToString("N"),"path",folder,"name",string.IsNullOrEmpty(name) ? folder : name));
            }
            if (result.Count > 8) throw new IOException("最多设置八个自定义文件夹，本次未添加。请先移除不需要的入口。");
            return result.ToArray();
        }
    }
}
