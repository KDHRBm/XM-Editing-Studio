using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Diagnostics;

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
            throw new InvalidOperationException("字幕草稿修改不处理链接文件或链接目录，请选择草稿实际所在位置：" + path);
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
            if (processes.Length > 0) throw new InvalidOperationException("请保存草稿并完全退出剪映，再修改字幕；完成后重新打开草稿检查排版。");
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
}
