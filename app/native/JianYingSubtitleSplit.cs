using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

internal sealed partial class JianYingEngine
{
    private sealed class SubtitleSlice
    {
        public int Start, Length;
        public string Text;
        public int End { get { return Start + Length; } }
    }

    private static bool HanWidth(char c) { return c >= 0x2e80 && c <= 0x9fff || c >= 0xf900 && c <= 0xfaff; }

    private static int SubtitleLineCount(string text, int englishChars, int chineseChars)
    {
        double width = 0, limit = englishChars, han = (double)englishChars / chineseChars;
        int lines = 1;
        bool pendingSpace = false;
        for (int index = 0; index < text.Length; )
        {
            char c = text[index];
            if (c == '\r' || c == '\n') { lines++; width = 0; pendingSpace = false; index += c == '\r' && index + 1 < text.Length && text[index + 1] == '\n' ? 2 : 1; continue; }
            if (char.IsWhiteSpace(c)) { pendingSpace = width > 0; index++; continue; }
            int end = index + 1;
            if (!HanWidth(c)) while (end < text.Length && !char.IsWhiteSpace(text[end]) && !HanWidth(text[end])) end++;
            double token = 0;
            for (int cursor = index; cursor < end; cursor++) token += HanWidth(text[cursor]) ? han : 1;
            if (width > 0 && width + (pendingSpace ? 1 : 0) + token > limit) { lines++; width = 0; }
            if (token > limit) {
                for (int cursor = index; cursor < end; cursor++) {
                    double letter = HanWidth(text[cursor]) ? han : 1;
                    if (width > 0 && width + letter > limit) { lines++; width = 0; }
                    width += letter;
                }
            } else width += (width > 0 && pendingSpace ? 1 : 0) + token;
            pendingSpace = false; index = end;
        }
        return lines;
    }

    private static SubtitleSlice TrimSlice(string text, int start, int end)
    {
        while (start < end && char.IsWhiteSpace(text[start])) start++;
        while (end > start && char.IsWhiteSpace(text[end - 1])) end--;
        return new SubtitleSlice { Start = start, Length = end - start, Text = text.Substring(start, end - start) };
    }

    private static List<SubtitleSlice> SubtitleSlices(string text, int englishChars, int chineseChars)
    {
        var result = new List<SubtitleSlice> { TrimSlice(text, 0, text.Length) };
        for (int index = 0; index < result.Count; index++) {
            var part = result[index];
            if (SubtitleLineCount(part.Text, englishChars, chineseChars) < 4) continue;
            if (result.Count >= 32) return null;
            double middle = part.Start + part.Length / 2.0, distance = double.MaxValue;
            int cut = -1;
            for (int cursor = part.Start + 1; cursor < part.End - 1; cursor++) {
                if (text[cursor - 1] != ',' && text[cursor - 1] != '，') continue;
                int next = cursor;
                while (next < part.End && text[next] == ' ') next++;
                if (cursor - part.Start < part.Length / 5 || part.End - next < part.Length / 5) continue;
                double gap = Math.Abs(cursor - middle);
                if (gap < distance || gap == distance && cursor > cut) { cut = cursor; distance = gap; }
            }
            if (cut >= 0) {
                var beforeComma = TrimSlice(text, part.Start, cut);
                var afterComma = TrimSlice(text, cut, part.End);
                result[index] = beforeComma; result.Insert(index + 1, afterComma);
                index--; continue;
            }
            for (int cursor = part.Start + 1; cursor < part.End - 1; cursor++) {
                if (text[cursor] != ' ') continue;
                double gap = Math.Abs(cursor - middle);
                if (gap < distance || gap == distance && cursor > cut) { cut = cursor; distance = gap; }
            }
            if (cut < 0 && part.Text.Any(HanWidth)) {
                const string punctuation = "，。！？；、,.!?;";
                for (int cursor = part.Start + 1; cursor < part.End - 1; cursor++) {
                    if (punctuation.IndexOf(text[cursor - 1]) < 0) continue;
                    double gap = Math.Abs(cursor - middle);
                    if (gap < distance || gap == distance && cursor > cut) { cut = cursor; distance = gap; }
                }
                if (cut < 0) cut = (int)middle;
                if (cut > part.Start && char.IsLowSurrogate(text[cut])) cut--;
            }
            if (cut <= part.Start || cut >= part.End || cut - part.Start < part.Length / 5 || part.End - cut < part.Length / 5) return null;
            var left = TrimSlice(text, part.Start, cut);
            var right = TrimSlice(text, cut + (text[cut] == ' ' ? 1 : 0), part.End);
            if (left.Length == 0 || right.Length == 0) return null;
            result[index] = left; result.Insert(index + 1, right);
            index--;
        }
        return result.Count > 1 ? result : new List<SubtitleSlice>();
    }

    private static string SubtitleAtoms(string text)
    {
        var result = new StringBuilder();
        foreach (char c in text.Normalize(NormalizationForm.FormKC)) if (char.IsLetterOrDigit(c)) result.Append(char.ToLowerInvariant(c));
        return result.ToString();
    }

    private static SubtitleSlice MapSubtitleSlice(string display, SubtitleSlice span, string target)
    {
        if (SubtitleAtoms(display) != SubtitleAtoms(target)) return null;
        int before = SubtitleAtoms(display.Substring(0, span.Start)).Length;
        int through = SubtitleAtoms(display.Substring(0, span.End)).Length;
        var positions = new List<int>();
        for (int i = 0; i < target.Length; i++) if (char.IsLetterOrDigit(target[i])) positions.Add(i);
        if (positions.Count != SubtitleAtoms(target).Length) return null;
        if (before > positions.Count || through > positions.Count || before > through) return null;
        int begin = before == 0 ? 0 : before == positions.Count ? target.Length : positions[before];
        int end = through == positions.Count ? target.Length : positions[through];
        return TrimSlice(target, begin, end);
    }

    private IDictionary CloneSubtitleDictionary(IDictionary value) { return _json.DeserializeObject(_json.Serialize(value)) as IDictionary; }

    private bool ClipSubtitleContent(IDictionary material, string key, string display, SubtitleSlice slice)
    {
        if (!material.Contains(key)) return true;
        bool serialized = material[key] is string;
        IDictionary content;
        try { content = serialized ? _json.DeserializeObject((string)material[key]) as IDictionary : material[key] as IDictionary; }
        catch (ArgumentException) { return false; }
        if (content == null || !content.Contains("text") || !(content["text"] is string)) return false;
        string source = (string)content["text"];
        var mapped = key == "content" ? slice : MapSubtitleSlice(display, slice, source);
        if (mapped == null || mapped.Length == 0) return false;
        var styles = content.Contains("styles") ? content["styles"] as IList : null;
        if (styles != null) {
            var clipped = new ArrayList();
            foreach (var item in styles) {
                var style = item as IDictionary;
                var range = style != null && style.Contains("range") ? style["range"] as IList : null;
                if (range == null || range.Count != 2) return false;
                int start, length;
                try { start = Convert.ToInt32(range[0]); length = Convert.ToInt32(range[1]); } catch { return false; }
                if (start < 0 || length < 0 || start + length > source.Length) return false;
                int from = Math.Max(start, mapped.Start), to = Math.Min(start + length, mapped.End);
                if (from >= to) continue;
                var copy = CloneSubtitleDictionary(style);
                copy["range"] = new[] { from - mapped.Start, to - from };
                clipped.Add(copy);
            }
            if (styles.Count > 0 && clipped.Count == 0) return false;
            content["styles"] = clipped;
        }
        content["text"] = mapped.Text;
        material[key] = serialized ? (object)_json.Serialize(content) : content;
        return true;
    }

    private static bool ClipSubtitleField(IDictionary material, string key, string display, SubtitleSlice slice)
    {
        if (!material.Contains(key) || !(material[key] is string) || string.IsNullOrEmpty((string)material[key])) return true;
        var mapped = MapSubtitleSlice(display, slice, (string)material[key]);
        if (mapped == null) return false;
        material[key] = mapped.Text;
        return true;
    }

    private static bool SubtitleWordCuts(IDictionary words, string display, List<SubtitleSlice> slices, out int[] cuts)
    {
        cuts = new int[slices.Count + 1];
        if (words == null || words.Count == 0) return true;
        if (words.Keys.Cast<object>().Any(key => !new[] { "text", "start_time", "end_time" }.Contains(Convert.ToString(key)))) return false;
        if (!words.Contains("text") || !words.Contains("start_time") || !words.Contains("end_time")) return false;
        var texts = words["text"] as IList; var starts = words["start_time"] as IList; var ends = words["end_time"] as IList;
        if (texts == null || starts == null || ends == null || texts.Count != starts.Count || texts.Count != ends.Count) return false;
        if (texts.Count == 0) return true;
        if (SubtitleAtoms(string.Join("", texts.Cast<object>().Select(Convert.ToString))) != SubtitleAtoms(display)) return false;
        try {
            for (int index = 0; index < starts.Count; index++) {
                long start = Convert.ToInt64(starts[index]), end = Convert.ToInt64(ends[index]);
                if (start < 0 || end < start || index > 0 && start < Convert.ToInt64(starts[index - 1])) return false;
            }
        } catch { return false; }
        int count = 0, part = 1;
        for (int index = 0; index < texts.Count; index++) {
            count += SubtitleAtoms(Convert.ToString(texts[index])).Length;
            while (part < slices.Count && count == SubtitleAtoms(display.Substring(0, slices[part].Start)).Length) cuts[part++] = index + 1;
            if (part < slices.Count && count > SubtitleAtoms(display.Substring(0, slices[part].Start)).Length) return false;
        }
        cuts[slices.Count] = texts.Count;
        return part == slices.Count;
    }

    private static bool ClipSubtitleWords(IDictionary material, int from, int to, long relativeStartUs)
    {
        var words = material.Contains("words") ? material["words"] as IDictionary : null;
        if (words == null || words.Count == 0) return true;
        var text = words["text"] as IList; var start = words["start_time"] as IList; var end = words["end_time"] as IList;
        var texts = new ArrayList(); var starts = new ArrayList(); var ends = new ArrayList();
        for (int i = from; i < to; i++) {
            texts.Add(text[i]);
            starts.Add(Math.Max(0, Convert.ToInt64(start[i]) - relativeStartUs / 1000));
            ends.Add(Math.Max(0, Convert.ToInt64(end[i]) - relativeStartUs / 1000));
        }
        words["text"] = texts; words["start_time"] = starts; words["end_time"] = ends;
        return true;
    }

    private int SplitLongSubtitles(IDictionary data, int englishChars, int chineseChars, out int skipped)
    {
        skipped = 0; int changed = 0;
        var materials = data["materials"] as IDictionary;
        var texts = materials != null ? materials["texts"] as IList : null;
        if (texts == null) return 0;
        var allTexts = new ArrayList(texts);
        var subtitleMaterials = GetSubtitleMaterials(data);
        var references = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var track in GetSubtitleTracks(data)) foreach (var item in (IList)track["segments"]) {
            var segment = item as IDictionary;
            if (segment == null || !segment.Contains("material_id")) continue;
            string id = Convert.ToString(segment["material_id"]);
            references[id] = references.ContainsKey(id) ? references[id] + 1 : 1;
        }
        foreach (var track in GetSubtitleTracks(data)) {
            var original = track["segments"] as IList;
            var segments = new ArrayList();
            foreach (var item in original) {
                segments.Add(item);
                var segment = item as IDictionary;
                string id = segment != null && segment.Contains("material_id") ? Convert.ToString(segment["material_id"]) : "";
                if (!subtitleMaterials.ContainsKey(id)) continue;
                var material = subtitleMaterials[id];
                IDictionary content;
                try { content = !material.Contains("content") ? null : material["content"] is string ? _json.DeserializeObject((string)material["content"]) as IDictionary : material["content"] as IDictionary; }
                catch (ArgumentException) { continue; }
                string text = content != null && content.Contains("text") && content["text"] is string ? (string)content["text"] : "";
                var slices = SubtitleSlices(text, englishChars, chineseChars);
                if (slices == null) { skipped++; continue; }
                if (slices.Count == 0) continue;
                var timerange = segment.Contains("target_timerange") ? segment["target_timerange"] as IDictionary : null;
                long start, duration;
                try { start = Convert.ToInt64(timerange["start"]); duration = Convert.ToInt64(timerange["duration"]); }
                catch { skipped++; continue; }
                var words = material.Contains("words") ? material["words"] as IDictionary : null;
                var currentWords = material.Contains("current_words") ? material["current_words"] as IDictionary : null;
                var currentList = material.Contains("current_words") ? material["current_words"] as IList : null;
                var keywords = material.Contains("subtitle_keywords") ? material["subtitle_keywords"] as IDictionary : null;
                int[] wordCuts;
                if (references[id] != 1 || duration < slices.Count * 300000L ||
                    segment.Contains("render_timerange") && segment["render_timerange"] is IDictionary && ((IDictionary)segment["render_timerange"]).Count > 0 ||
                    keywords != null && keywords.Count > 0 ||
                    currentWords != null && currentWords.Count > 0 || currentList != null && currentList.Count > 0 ||
                    !SubtitleWordCuts(words, text, slices, out wordCuts)) { skipped++; continue; }
                var offsets = new long[slices.Count + 1]; offsets[slices.Count] = duration;
                for (int n = 1; n < slices.Count; n++) {
                    long proportional = duration * slices[n].Start / text.Length;
                    long chosen = proportional;
                    if (words != null && words.Count > 0) {
                        var starts = (IList)words["start_time"]; var ends = (IList)words["end_time"];
                        int cut = wordCuts[n];
                        if (cut > 0 && cut < starts.Count) {
                            long prev = Convert.ToInt64(ends[cut - 1]), next = Convert.ToInt64(starts[cut]);
                            long timed = (prev + next) * 500;
                            if (prev >= 0 && next >= prev && timed > 0 && timed < duration && Math.Abs(timed - proportional) < duration / 3) chosen = timed;
                        }
                    }
                    offsets[n] = chosen;
                }
                if (Enumerable.Range(0, slices.Count).Any(n => offsets[n + 1] - offsets[n] < 150000)) { skipped++; continue; }
                var copies = new List<IDictionary>(); bool valid = true;
                for (int n = 0; n < slices.Count; n++) {
                    var copy = CloneSubtitleDictionary(material);
                    valid = ClipSubtitleContent(copy, "content", text, slices[n]) &&
                        ClipSubtitleContent(copy, "base_content", text, slices[n]) &&
                        ClipSubtitleField(copy, "recognize_text", text, slices[n]) &&
                        ClipSubtitleField(copy, "translate_original_text", text, slices[n]);
                    if (!valid) break;
                    ClipSubtitleWords(copy, wordCuts[n], wordCuts[n + 1], offsets[n]);
                    if (n > 0) copy["id"] = Guid.NewGuid().ToString("D").ToUpperInvariant();
                    copies.Add(copy);
                }
                if (!valid) { skipped++; continue; }
                foreach (var pair in copies.Select((copy, n) => new { copy, n })) {
                    int n = pair.n;
                    var nextSegment = n == 0 ? segment : CloneSubtitleDictionary(segment);
                    var range = (IDictionary)nextSegment["target_timerange"];
                    range["start"] = start + offsets[n]; range["duration"] = offsets[n + 1] - offsets[n];
                    nextSegment["material_id"] = pair.copy["id"];
                    if (n > 0) { nextSegment["id"] = Guid.NewGuid().ToString("D").ToUpperInvariant(); segments.Add(nextSegment); allTexts.Add(pair.copy); }
                    else {
                        int index = allTexts.IndexOf(material);
                        allTexts[index] = pair.copy;
                    }
                }
                changed += slices.Count - 1;
            }
            track["segments"] = segments;
        }
        materials["texts"] = allTexts;
        return changed;
    }

    private void RunSubtitleSplitPreview(int gen, int englishChars, int chineseChars)
    {
        RequirePunctuationIdle();
        var pending = new List<Tuple<string, IDictionary>>();
        var expected = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var names = new List<string>(); int additions = 0, skipped = 0;
        foreach (string directory in PunctuationDraftDirectories(_draftDir)) {
            CheckInterrupted(gen); RequireRealPath(directory);
            string timelines = Path.Combine(directory, "Timelines");
            if (Directory.Exists(timelines)) { RequireRealPath(timelines); foreach (string timeline in Directory.GetDirectories(timelines)) RequireRealPath(timeline); }
            var files = SubtitleJsonPaths(directory).Where(File.Exists).ToArray();
            foreach (string file in files) { RequireRealPath(file); expected[file] = Sha256(file); }
            var items = FindSubtitleJsons(directory); int inDraft = 0, inDraftSkipped = 0;
            foreach (var item in items) { int skippedHere; int count = SplitLongSubtitles(item.Item2, englishChars, chineseChars, out skippedHere); inDraftSkipped += skippedHere; inDraft += count; if (count > 0) pending.Add(item); }
            skipped += inDraftSkipped;
            foreach (string file in files) if (Sha256(file) != expected[file]) throw new InvalidOperationException("检查期间草稿已变化，请重新预览：" + file);
            if (inDraft > 0) { additions += inDraft; names.Add(Path.GetFileName(directory)); }
            if (inDraft > 0 || inDraftSkipped > 0) Log("字幕拆分预览：" + Path.GetFileName(directory) + "，将新增 " + inDraft + " 条，跳过 " + inDraftSkipped + " 条");
        }
        CheckInterrupted(gen);
        if (pending.Count == 0) { ShowNotice("检查完成", "没有可安全拆分的四行字幕，草稿未改动。" + (skipped > 0 ? "跳过 " + skipped + " 条结构不兼容或时间不足的字幕，详见任务日志。" : "")); return; }
        AskYesNo("拆分长字幕", "检测到 " + names.Count + " 个草稿将新增 " + additions + " 条字幕：\n" + string.Join("、", names.Take(12)) + (names.Count > 12 ? " 等" : "") +
            (skipped > 0 ? "\n另有 " + skipped + " 条无法安全拆分，保持原样。" : "") +
            "\n按当前英文每行 " + englishChars + " 字、中文每行 " + chineseChars + " 字估算；四行及以上优先在中点附近逗号后拆分，否则按空格拆分。自动备份原草稿，确认后写入并校验。",
            () => BeginOperation(next => {
                RequirePunctuationIdle();
                foreach (var pair in expected) { CheckInterrupted(next); RequireRealPath(pair.Key); if (Sha256(pair.Key) != pair.Value) throw new InvalidOperationException("草稿在预览后已变化，请重新检查：" + pair.Key); }
                SaveSubtitleJsonsChecked(pending, next, expected, RequirePunctuationIdle, "split_subtitles");
                ShowNotice("字幕拆分完成", "已为 " + names.Count + " 个草稿新增 " + additions + " 条字幕。原文件旁保留 before_split_subtitles 备份，请重新打开剪映检查时间和排版。");
            }));
    }
}
