using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Text;

internal sealed partial class JianYingEngine
{
    private static string Sha256(string file)
    {
        using (var stream = File.OpenRead(file)) using (var hash = SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    // One UTF-16 character in, one out: all style ranges, word timings and
    // animation indices remain valid. Do not normalize real Chinese punctuation.
    private static string StandardSubtitleMarks(string text)
    {
        return text.Replace('․', '.').Replace('﹒', '.').Replace('‚', ',').Replace('﹐', ',');
    }

    private bool RestoreTextField(IDictionary value, string key)
    {
        if (!value.Contains(key) || !(value[key] is string)) return false;
        string before = (string)value[key], after = StandardSubtitleMarks(before);
        if (before == after) return false;
        value[key] = after; return true;
    }

    private bool RestoreContentField(IDictionary material, string key)
    {
        if (!material.Contains(key)) return false;
        var content = material[key] as IDictionary;
        if (content != null) return RestoreTextField(content, "text");
        var raw = material[key] as string;
        if (raw == null) return false;
        if (!raw.TrimStart().StartsWith("{") && !raw.TrimStart().StartsWith("[")) return RestoreTextField(material, key);
        try { content = _json.DeserializeObject(raw) as IDictionary; }
        catch (ArgumentException) { throw new InvalidOperationException("字幕内容格式异常，未写入草稿。请先在剪映检查字幕：" + Convert.ToString(material["id"])); }
        if (content == null || !content.Contains("text") || !(content["text"] is string))
            throw new InvalidOperationException("字幕内容结构不受支持，未写入草稿：" + Convert.ToString(material["id"]));
        if (!RestoreTextField(content, "text")) return false;
        material[key] = _json.Serialize(content); return true;
    }

    private bool RestoreWordText(object value)
    {
        bool changed = false;
        var words = value as IDictionary;
        if (words != null) {
            if (words.Contains("text")) {
                if (words["text"] is string) return RestoreTextField(words, "text");
                var list = words["text"] as IList;
                if (list != null) for (int index = 0; index < list.Count; index++) {
                    string before = list[index] as string;
                    if (before == null) continue;
                    string after = StandardSubtitleMarks(before);
                    if (before != after) { list[index] = after; changed = true; }
                }
            }
        } else {
            var list = value as IList;
            if (list != null) foreach (var item in list) {
                var word = item as IDictionary;
                if (word != null) changed |= RestoreTextField(word, "text");
            }
        }
        return changed;
    }

    private int RestoreSubtitlePunctuation(IDictionary data)
    {
        var active = new HashSet<string>(StringComparer.Ordinal);
        foreach (var track in GetSubtitleTracks(data)) {
            var segments = track["segments"] as IList;
            if (segments == null) continue;
            foreach (var item in segments) {
                var segment = item as IDictionary;
                if (segment != null && segment.Contains("material_id")) active.Add(Convert.ToString(segment["material_id"]));
            }
        }
        int changed = 0;
        foreach (var pair in GetSubtitleMaterials(data)) {
            if (!active.Contains(pair.Key)) continue;
            var material = pair.Value;
            bool edited = RestoreContentField(material, "content");
            edited |= RestoreContentField(material, "base_content");
            edited |= RestoreTextField(material, "recognize_text");
            foreach (string key in new[] { "words", "current_words" }) if (material.Contains(key)) edited |= RestoreWordText(material[key]);
            if (edited) changed++;
        }
        return changed;
    }

    private static void RequireRealPath(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("标点还原不处理链接文件或链接目录，请选择草稿实际所在位置：" + path);
    }

    private static IEnumerable<string> PunctuationDraftDirectories(string root)
    {
        if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) throw new InvalidOperationException("请先选择草稿目录。");
        RequireRealPath(root);
        if (File.Exists(Path.Combine(root, "draft_content.json")) || Directory.Exists(Path.Combine(root, "Timelines"))) return new[] { root };
        return Directory.GetDirectories(root).Where(dir => File.Exists(Path.Combine(dir, "draft_content.json")) || Directory.Exists(Path.Combine(dir, "Timelines"))).OrderBy(dir => dir, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private void RequirePunctuationIdle()
    {
        var processes = Process.GetProcessesByName("JianyingPro");
        try {
            if (processes.Length > 0) throw new InvalidOperationException("请保存草稿并完全退出剪映，再还原标准标点。重新打开草稿后即可按标准标点排版。");
        } finally { foreach (var process in processes) process.Dispose(); }
    }

    private void RunPunctuationPreview(int gen)
    {
        RequirePunctuationIdle();
        var pending = new List<Tuple<string, IDictionary>>();
        var expected = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var names = new List<string>();
        foreach (string directory in PunctuationDraftDirectories(_draftDir)) {
            CheckInterrupted(gen); RequireRealPath(directory);
            string timelines = Path.Combine(directory, "Timelines");
            if (Directory.Exists(timelines)) { RequireRealPath(timelines); foreach (string timeline in Directory.GetDirectories(timelines)) RequireRealPath(timeline); }
            var files = SubtitleJsonPaths(directory).Where(File.Exists).ToArray();
            foreach (string file in files) { RequireRealPath(file); expected[file] = Sha256(file); }
            Log("检查标点：" + Path.GetFileName(directory));
            var items = FindSubtitleJsons(directory);
            foreach (string file in files) if (Sha256(file) != expected[file]) throw new InvalidOperationException("检查期间草稿已变化，请重新预览：" + file);
            bool changed = false;
            foreach (var item in items) if (RestoreSubtitlePunctuation(item.Item2) > 0) { pending.Add(item); changed = true; }
            if (changed) names.Add(Path.GetFileName(directory));
        }
        CheckInterrupted(gen);
        if (pending.Count == 0) { ShowNotice("检查完成", "未找到需要还原的替代标点，草稿没有改动。"); return; }
        AskYesNo("还原标准标点", "将处理 " + names.Count + " 个草稿：\n" + string.Join("、", names.Take(12)) + (names.Count > 12 ? " 等" : "") +
            "\n将 ․ / ﹒ 还原为 .，将 ‚ / ﹐ 还原为 ,，․․․ 还原为 ...。\n自动备份；保留字幕样式、时间轴和轨道显示状态。确认后批量处理，完成后重新打开剪映草稿。",
            () => BeginOperation(next => {
                RequirePunctuationIdle();
                foreach (var pair in expected) {
                    CheckInterrupted(next); RequireRealPath(pair.Key);
                    if (Sha256(pair.Key) != pair.Value) throw new InvalidOperationException("预览后草稿已变化，未写入，请重新检查：" + pair.Key);
                }
                SaveSubtitleJsonsChecked(pending, next, expected, RequirePunctuationIdle, "standard_punctuation");
                Log("已还原 " + names.Count + " 个草稿的标准标点；原文件旁已保存 before_standard_punctuation 备份。");
                ShowNotice("标点还原完成", "已处理 " + names.Count + " 个草稿。请重新打开剪映草稿检查排版；字幕样式、时间轴及显示状态保持不变。");
            }));
    }

    private string ResolveDraftRootDirectory()
    {
        if (!string.IsNullOrWhiteSpace(_draftDir) && Directory.Exists(_draftDir))
            return Path.GetFullPath(_draftDir);
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (!string.IsNullOrWhiteSpace(localAppData))
        {
            string defaultDir = Path.Combine(localAppData, "JianyingPro", "User Data", "Projects", "com.lveditor.draft");
            if (Directory.Exists(defaultDir))
            {
                _draftDir = Path.GetFullPath(defaultDir);
                SaveConfig();
                return _draftDir;
            }
        }
        throw new InvalidOperationException("请先在「02 字幕工程」中选择剪映草稿根目录 (JianyingPro Drafts)。");
    }

    private static long GetDictLong(IDictionary dict, string key, long fallback)
    {
        if (dict == null || !dict.Contains(key) || dict[key] == null) return fallback;
        try { return Convert.ToInt64(dict[key]); }
        catch { return fallback; }
    }

    private static long ComputeTracksMaxEnd(IDictionary data)
    {
        long maxEnd = 0L;
        if (data == null || !data.Contains("tracks")) return maxEnd;
        var tracks = data["tracks"] as IList;
        if (tracks == null) return maxEnd;
        foreach (object trObj in tracks)
        {
            var tr = trObj as IDictionary;
            if (tr == null || !tr.Contains("segments")) continue;
            var segs = tr["segments"] as IList;
            if (segs == null) continue;
            foreach (object segObj in segs)
            {
                var seg = segObj as IDictionary;
                if (seg == null || !seg.Contains("target_timerange")) continue;
                var range = seg["target_timerange"] as IDictionary;
                if (range == null) continue;
                long end = GetDictLong(range, "start", 0L) + GetDictLong(range, "duration", 0L);
                if (end > maxEnd) maxEnd = end;
            }
        }
        return maxEnd;
    }

    private IDictionary ReadDraftJson(string file, int gen, out bool isEncrypted)
    {
        isEncrypted = false;
        string raw = File.ReadAllText(file, Encoding.UTF8);
        if (raw.TrimStart().StartsWith("{"))
        {
            try
            {
                var plain = _json.DeserializeObject(raw) as IDictionary;
                if (plain != null) return plain;
            }
            catch (ArgumentException) { }
        }
        isEncrypted = true;
        return JianYingDraftIO.Request("read", file, null, () => CheckInterrupted(gen), Log);
    }

    private void WriteDraftJson(string file, IDictionary data, bool isEncrypted, int gen)
    {
        CheckInterrupted(gen);
        IDictionary verified;
        if (isEncrypted)
        {
            verified = JianYingDraftIO.Request("write", file, _json.Serialize(data), () => CheckInterrupted(gen));
        }
        else
        {
            AtomicWriteJson(file, data);
            verified = _json.DeserializeObject(File.ReadAllText(file, Encoding.UTF8)) as IDictionary;
        }
        if (!SameJson(data, verified))
            throw new InvalidOperationException("草稿写入后校验不一致：" + file);
    }

    private void CopyDraftDirectory(string sourceDir, string targetDir, int gen)
    {
        CheckInterrupted(gen);
        RequireRealPath(sourceDir);
        Directory.CreateDirectory(targetDir);
        foreach (string file in Directory.GetFiles(sourceDir))
        {
            CheckInterrupted(gen);
            RequireRealPath(file);
            string fileName = Path.GetFileName(file);
            if (fileName.IndexOf(".before_", StringComparison.OrdinalIgnoreCase) >= 0 &&
                fileName.EndsWith(".bak", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            if (fileName.IndexOf(".tmp-", StringComparison.OrdinalIgnoreCase) >= 0 ||
                string.Equals(fileName, "LOCK", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            File.Copy(file, Path.Combine(targetDir, fileName), true);
        }
        foreach (string subDir in Directory.GetDirectories(sourceDir))
        {
            CheckInterrupted(gen);
            RequireRealPath(subDir);
            string subName = Path.GetFileName(subDir);
            CopyDraftDirectory(subDir, Path.Combine(targetDir, subName), gen);
        }
    }

    private void TryRegisterLowerDraftInRootMeta(string parentDir, string upperName, string upperDir, string lowerName, string lowerDir, string newDraftId, long nowUs)
    {
        try
        {
            string rootMetaPath = Path.Combine(parentDir, "root_meta_info.json");
            if (!File.Exists(rootMetaPath)) return;
            RequireRealPath(rootMetaPath);
            string raw = File.ReadAllText(rootMetaPath, Encoding.UTF8);
            if (!raw.TrimStart().StartsWith("{")) return;
            var rootMeta = _json.DeserializeObject(raw) as IDictionary;
            if (rootMeta == null || !rootMeta.Contains("all_draft_store")) return;
            var store = rootMeta["all_draft_store"] as IList;
            if (store == null) return;

            string upperFoldPath = upperDir.Replace('\\', '/');
            string lowerFoldPath = lowerDir.Replace('\\', '/');
            IDictionary upperEntry = null;
            int upperIndex = -1;
            for (int i = 0; i < store.Count; i++)
            {
                var entry = store[i] as IDictionary;
                if (entry == null) continue;
                string dName = entry.Contains("draft_name") ? Convert.ToString(entry["draft_name"]) : "";
                string dPath = entry.Contains("draft_fold_path") ? Convert.ToString(entry["draft_fold_path"]) : "";
                if (string.Equals(dName, lowerName, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(dPath, lowerFoldPath, StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }
                if (upperEntry == null && (string.Equals(dName, upperName, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(dPath, upperFoldPath, StringComparison.OrdinalIgnoreCase)))
                {
                    upperEntry = entry;
                    upperIndex = i;
                }
            }
            if (upperEntry == null) return;
            var cloned = _json.DeserializeObject(_json.Serialize(upperEntry)) as IDictionary;
            if (cloned == null) return;
            cloned["draft_name"] = lowerName;
            cloned["draft_fold_path"] = lowerFoldPath;
            cloned["draft_cover"] = lowerFoldPath + "\\draft_cover.jpg";
            cloned["draft_json_file"] = lowerFoldPath + "\\draft_content.json";
            cloned["draft_id"] = newDraftId;
            cloned["tm_draft_create"] = nowUs;
            cloned["tm_draft_modified"] = nowUs;
            if (cloned.Contains("tm_draft_cloud_modified")) cloned["tm_draft_cloud_modified"] = nowUs;
            var mutableStore = new ArrayList(store);
            mutableStore.Insert(upperIndex >= 0 ? upperIndex : 0, cloned);
            rootMeta["all_draft_store"] = mutableStore;
            if (rootMeta.Contains("draft_ids")) rootMeta["draft_ids"] = mutableStore.Count;
            AtomicWriteJson(rootMetaPath, rootMeta);
        }
        catch { }
    }

    private void RunSplitUpperLowerDrafts(int gen)
    {
        string root = ResolveDraftRootDirectory();
        var directories = PunctuationDraftDirectories(root).ToArray();
        var created = new List<string>();
        var skippedExisting = new List<string>();
        var skippedNoOutPoint = new List<string>();

        foreach (string upperDir in directories)
        {
            CheckInterrupted(gen);
            RequireRealPath(upperDir);
            string upperName = Path.GetFileName(upperDir);
            if (string.IsNullOrEmpty(upperName) || upperName.Length < 2 || !upperName.EndsWith("上", StringComparison.Ordinal))
                continue;

            string parentDir = Path.GetDirectoryName(upperDir);
            if (string.IsNullOrEmpty(parentDir)) continue;
            string lowerName = upperName.Substring(0, upperName.Length - 1) + "下";
            string lowerDir = Path.Combine(parentDir, lowerName);
            if (Directory.Exists(lowerDir))
            {
                skippedExisting.Add(lowerName);
                Log("跳过草稿 " + upperName + "：已存在 " + lowerName);
                continue;
            }

            long outPoint = -1L;
            long totalDuration = 0L;
            foreach (string jsonPath in SubtitleJsonPaths(upperDir))
            {
                if (!File.Exists(jsonPath)) continue;
                RequireRealPath(jsonPath);
                bool enc;
                var data = ReadDraftJson(jsonPath, gen, out enc);
                if (data == null) continue;
                long durCandidate = Math.Max(GetDictLong(data, "duration", 0L), ComputeTracksMaxEnd(data));
                if (durCandidate > totalDuration) totalDuration = durCandidate;
                var cfg = data.Contains("config") ? data["config"] as IDictionary : null;
                var er = cfg != null && cfg.Contains("export_range") ? cfg["export_range"] as IDictionary : null;
                if (er != null && outPoint <= 0)
                {
                    long st = GetDictLong(er, "start", 0L);
                    long dur = GetDictLong(er, "duration", 0L);
                    if (dur > 0) outPoint = st + dur;
                }
            }

            if (outPoint <= 0 || (totalDuration > 0 && outPoint >= totalDuration))
            {
                skippedNoOutPoint.Add(upperName);
                Log("⚠ 跳过草稿 " + upperName + "：未检测到有效出点 (export_range)");
                continue;
            }

            long lowerDuration = totalDuration > outPoint ? (totalDuration - outPoint) : 0L;
            try
            {
                CopyDraftDirectory(upperDir, lowerDir, gen);

                foreach (string jsonPath in SubtitleJsonPaths(lowerDir))
                {
                    if (!File.Exists(jsonPath)) continue;
                    bool isEnc;
                    var data = ReadDraftJson(jsonPath, gen, out isEnc);
                    if (data == null) continue;
                    var cfg = data.Contains("config") && data["config"] is IDictionary
                        ? (IDictionary)data["config"]
                        : new Dictionary<string, object>();
                    data["config"] = cfg;
                    cfg["export_range"] = new Dictionary<string, object>
                    {
                        { "start", outPoint },
                        { "duration", lowerDuration }
                    };
                    WriteDraftJson(jsonPath, data, isEnc, gen);

                    string bakFile = jsonPath + ".bak";
                    if (File.Exists(bakFile)) File.Copy(jsonPath, bakFile, true);
                    string tpl2File = Path.Combine(Path.GetDirectoryName(jsonPath), "template-2.tmp");
                    if (File.Exists(tpl2File)) File.Copy(jsonPath, tpl2File, true);
                }

                string timelinesDir = Path.Combine(lowerDir, "Timelines");
                if (Directory.Exists(timelinesDir))
                {
                    foreach (string tlSub in Directory.GetDirectories(timelinesDir))
                    {
                        string tplJson = Path.Combine(tlSub, "template.json");
                        if (!File.Exists(tplJson)) continue;
                        try
                        {
                            bool tplEnc;
                            var tplData = ReadDraftJson(tplJson, gen, out tplEnc);
                            if (tplData != null && tplData.Contains("config") && tplData["config"] is IDictionary)
                            {
                                ((IDictionary)tplData["config"])["export_range"] = new Dictionary<string, object>
                                {
                                    { "start", outPoint },
                                    { "duration", lowerDuration }
                                };
                                WriteDraftJson(tplJson, tplData, tplEnc, gen);
                            }
                        }
                        catch { }
                    }
                }

                string newDraftId = Guid.NewGuid().ToString().ToUpperInvariant();
                long nowUs = (DateTime.UtcNow.Ticks - 621355968000000000L) / 10L;
                string lowerFoldPath = lowerDir.Replace('\\', '/');
                string metaPath = Path.Combine(lowerDir, "draft_meta_info.json");
                if (File.Exists(metaPath))
                {
                    try
                    {
                        bool metaEnc;
                        var meta = ReadDraftJson(metaPath, gen, out metaEnc);
                        if (meta != null)
                        {
                            meta["draft_name"] = lowerName;
                            meta["draft_fold_path"] = lowerFoldPath;
                            meta["draft_id"] = newDraftId;
                            meta["tm_draft_create"] = nowUs;
                            meta["tm_draft_modified"] = nowUs;
                            if (meta.Contains("tm_draft_cloud_modified")) meta["tm_draft_cloud_modified"] = nowUs;
                            WriteDraftJson(metaPath, meta, metaEnc, gen);
                        }
                    }
                    catch { }
                }

                TryRegisterLowerDraftInRootMeta(parentDir, upperName, upperDir, lowerName, lowerDir, newDraftId, nowUs);
                created.Add(lowerName);
                Log(string.Format("✓ 已复制草稿：{0} → {1}（入点 {2}，时长 {3}）", upperName, lowerName, FormatSrtTime(outPoint), FormatSrtTime(lowerDuration)));
            }
            catch
            {
                if (Directory.Exists(lowerDir))
                {
                    try { Directory.Delete(lowerDir, true); } catch { }
                }
                throw;
            }
        }

        if (created.Count > 0)
        {
            string summary = string.Format("共生成 {0} 个下集草稿：{1}", created.Count, string.Join("、", created.Take(8)) + (created.Count > 8 ? " 等" : ""));
            Log(summary);
            ShowNotice("下集草稿生成完成", summary);
        }
        else if (skippedNoOutPoint.Count > 0)
        {
            string msg = string.Format("发现 {0} 个「上」草稿（{1}）未设置有效出点", skippedNoOutPoint.Count, string.Join("、", skippedNoOutPoint.Take(6)));
            Log(msg);
            ShowNotice("未生成新草稿", msg);
        }
        else if (skippedExisting.Count > 0)
        {
            string msg = string.Format("共检测到 {0} 个「上」草稿，对应「下」草稿均已存在", skippedExisting.Count);
            Log(msg);
            ShowNotice("检测完成", msg);
        }
        else
        {
            string msg = "草稿目录中未发现以「上」结尾的草稿文件夹";
            Log(msg);
            ShowNotice("检测完成", msg);
        }
    }
}
