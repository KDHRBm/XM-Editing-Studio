using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace XM.Native {
    // Read only Ollama manifests and referenced file lengths, never the weights.
    internal static class LocalModelInventory {
        private static readonly Regex Digest = new Regex(@"^sha256:[a-f0-9]{64}$", RegexOptions.CultureInvariant);
        private static bool Plain(string path) { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0; }
        private static IEnumerable<string> Manifests(string path, int depth) {
            if (!Directory.Exists(path) || !Plain(path) || depth > 8) yield break;
            foreach (string file in Directory.GetFiles(path)) if (Plain(file)) yield return file;
            foreach (string child in Directory.GetDirectories(path)) foreach (string file in Manifests(child, depth + 1)) yield return file;
        }
        internal static object Read(string modelsPath) {
            var models = new List<object>();
            var blobs = new Dictionary<string, long>(StringComparer.Ordinal);
            int unreadable = 0;
            string root = Path.GetFullPath(modelsPath).TrimEnd(Path.DirectorySeparatorChar);
            string manifests = Path.Combine(root, "manifests"), blobRoot = Path.Combine(root, "blobs");
            if (!Directory.Exists(root)) return J.Obj("models", models, "bytes", 0L, "warning", "");
            if (!Plain(root) || (Directory.Exists(blobRoot) && !Plain(blobRoot)))
                return J.Obj("models", models, "bytes", 0L, "warning", "模型目录为链接，未自动管理，请检查实际存储位置。");
            try {
                foreach (string file in Manifests(manifests, 0).Take(1001)) {
                    if (models.Count >= 1000) { unreadable++; break; }
                    try {
                        string relative = file.Substring(manifests.Length + 1);
                        string[] parts = relative.Split(Path.DirectorySeparatorChar);
                        if (parts.Length < 4 || parts.Any(p => !Regex.IsMatch(p, @"^[a-zA-Z0-9][a-zA-Z0-9._:-]*$"))) continue;
                        int skip = parts[0] == "registry.ollama.ai" ? (parts[1] == "library" ? 2 : 1) : 0;
                        string name = string.Join("/", parts.Skip(skip).Take(parts.Length - skip - 1)) + ":" + parts.Last();
                        if (new FileInfo(file).Length > 1024 * 1024) { unreadable++; continue; }
                        object manifest = J.Read(file, null), config = J.Get(manifest, "config");
                        if (J.Num(manifest, "schemaVersion") != 2 || !(J.Get(manifest, "layers") is System.Collections.IList)) { unreadable++; continue; }
                        long size = 0; bool complete = true;
                        var seen = new HashSet<string>(StringComparer.Ordinal);
                        foreach (object descriptor in J.Arr(J.Get(manifest, "layers")).Concat(new[] { config })) {
                            string digest = J.Str(descriptor, "digest");
                            if (!Digest.IsMatch(digest)) { complete = false; continue; }
                            if (!seen.Add(digest)) continue;
                            string blob = Path.Combine(blobRoot, digest.Replace(':', '-'));
                            if (!File.Exists(blob) || !Plain(blob)) { complete = false; continue; }
                            long length = new FileInfo(blob).Length;
                            size += length; blobs[digest] = length;
                            if (length != J.Num(descriptor, "size", -1)) complete = false;
                        }
                        object detail = null;
                        string configDigest = J.Str(config, "digest");
                        if (Digest.IsMatch(configDigest)) {
                            string path = Path.Combine(blobRoot, configDigest.Replace(':', '-'));
                            if (File.Exists(path) && Plain(path) && new FileInfo(path).Length <= 1024 * 1024) {
                                try { detail = J.Read(path, null); } catch { /* Optional metadata. */ }
                            }
                        }
                        models.Add(J.Obj("name", name, "sizeBytes", size, "complete", complete,
                            "modifiedAt", File.GetLastWriteTimeUtc(file).ToString("o"),
                            "family", J.Str(detail, "model_family"), "parameters", J.Str(detail, "model_type"),
                            "quantization", J.Str(detail, "file_type")));
                    } catch (IOException) { unreadable++; }
                    catch (UnauthorizedAccessException) { unreadable++; }
                    catch (ArgumentException) { unreadable++; }
                    catch (InvalidOperationException) { unreadable++; }
                }
            } catch (IOException) { unreadable++; }
            catch (UnauthorizedAccessException) { unreadable++; }
            return J.Obj("models", models.OrderBy(m => J.Str(m, "name"), StringComparer.OrdinalIgnoreCase).ToArray(),
                "bytes", blobs.Values.Sum(), "warning", unreadable == 0 ? "" : "部分模型清单无法读取，请打开模型目录检查。");
        }
    }
}
