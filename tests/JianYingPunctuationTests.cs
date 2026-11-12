using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;

internal static class JianYingPunctuationTests
{
    static JianYingEngine engine;
    static int checks;
    static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
    static IDictionary Obj(params object[] values) { var d = new Dictionary<string, object>(); for (int n = 0; n < values.Length; n += 2) d[(string)values[n]] = values[n + 1]; return d; }
    static object Call(string name, params object[] args) {
        try { return typeof(JianYingEngine).GetMethod(name, BindingFlags.Static | BindingFlags.Instance | BindingFlags.NonPublic).Invoke(engine, args); }
        catch (TargetInvocationException error) { throw error.InnerException; }
    }
    static void Check(bool value, string message) { if (!value) throw new Exception(message); checks++; }
    static void Reject(Action action, string message) { bool failed = false; try { action(); } catch { failed = true; } Check(failed, message); }
    static string Hash(string file) { return (string)Call("Sha256", file); }
    static IDictionary Clone(IDictionary data) { return (IDictionary)json.DeserializeObject(json.Serialize(data)); }
    static bool Same(object a, object b) { return (bool)Call("SameJson", a, b); }
    static IDictionary Material(string id, string type, string text) {
        return Obj("id", id, "type", type, "content", json.Serialize(Obj("text", text, "styles", new[] { Obj("range", new[] { 0, text.Length }, "font", Obj("path", "C:/font․ttf"), "size", 15, "color", "#ffffff") })),
            "recognize_text", type == "subtitle" ? text : "", "base_content", Obj("text", text, "font", "never-replace․ttf"),
            "words", Obj("text", new[] { "dinner", "․", "Mr․", "․․․" }, "start_time", new[] { 0, 20, 40, 60 }, "end_time", new[] { 20, 40, 60, 80 }),
            "current_words", new[] { Obj("text", "¿Sí‚ señor?", "start_time", 12, "end_time", 42) }, "extra", "not text․");
    }
    static IDictionary Fixture() {
        return Obj("new_version", "192.0.0", "materials", Obj("texts", new[] {
            Material("caption", "subtitle", "Ethan‚ my parents want you at our family dinner․ Mr․ Harris․․․"),
            Material("title", "text", "Do not change this title․"),
            Material("unused", "subtitle", "Unused old caption․") }),
            "tracks", new[] { Obj("type", "text", "segments", new[] {
                Obj("material_id", "caption", "visible", false, "target_timerange", Obj("start", 1234567, "duration", 7654321), "clip", Obj("transform", Obj("x", 0.2, "y", 0.6))),
                Obj("material_id", "title", "visible", true, "target_timerange", Obj("start", 0, "duration", 10000)) }) });
    }
    static void Core(string root) {
        var data = Fixture(); var before = Clone(data);
        Check((int)Call("RestoreSubtitlePunctuation", data) == 1, "Only active subtitle material is restored");
        var mats = (IList)((IDictionary)data["materials"])["texts"]; var old = (IList)((IDictionary)before["materials"])["texts"];
        var caption = (IDictionary)mats[0]; var oldCaption = (IDictionary)old[0];
        var content = (IDictionary)json.DeserializeObject((string)caption["content"]);
        var oldContent = (IDictionary)json.DeserializeObject((string)oldCaption["content"]);
        Check((string)content["text"] == "Ethan, my parents want you at our family dinner. Mr. Harris...", "Screenshot, title and ellipsis use real ASCII marks");
        Check(((string)content["text"]).Length == ((string)oldContent["text"]).Length, "Offsets unchanged");
        Check(Same(content["styles"], oldContent["styles"]), "Font, color, size, effects and style ranges unchanged");
        Check(Same(data["tracks"], before["tracks"]), "Tracks, timings, transforms and visibility unchanged");
        Check(Same(mats[1], old[1]) && Same(mats[2], old[2]), "Ordinary title and unused subtitle stay byte-equivalent as JSON");
        Check(Same(((IDictionary)caption["words"])["start_time"], ((IDictionary)oldCaption["words"])["start_time"]), "Word start times retained");
        Check(Same(((IDictionary)caption["words"])["end_time"], ((IDictionary)oldCaption["words"])["end_time"]), "Word end times retained");
        Check((string)((IList)((IDictionary)caption["words"])["text"])[1] == ".", "Word cache punctuation restored");
        Check((string)((IDictionary)((IList)caption["current_words"])[0])["text"] == "¿Sí, señor?", "Current word cache restored without losing accents");
        Check((string)caption["recognize_text"] == (string)content["text"], "Recognized text matches display text");
        Check((string)caption["extra"] == "not text․" && (string)((IDictionary)caption["base_content"])["font"] == "never-replace․ttf", "No global JSON string substitution");
        Check((int)Call("RestoreSubtitlePunctuation", data) == 0, "Running twice is a no-op");
        Check((string)Call("StandardSubtitleMarks", "中文。你好，¿Qué? - … 3․5 ﹐﹒") == "中文。你好，¿Qué? - … 3.5 ,.", "Original Chinese punctuation, dashes and ellipsis glyph unchanged");
        caption["content"] = "Plain text․"; Check((int)Call("RestoreSubtitlePunctuation", data) == 1 && (string)caption["content"] == "Plain text.", "Legacy plain content supported");
        caption["content"] = Obj("text", "Dictionary․", "styles", oldContent["styles"]); Check((int)Call("RestoreSubtitlePunctuation", data) == 1, "Object content supported");
        caption["content"] = "{bad-json․"; Reject(() => Call("RestoreSubtitlePunctuation", data), "Invalid serialized content cannot be written");

        string one = Path.Combine(root, "one.json"), two = Path.Combine(root, "two.json");
        File.WriteAllText(one, json.Serialize(Fixture()), new UTF8Encoding(false)); File.WriteAllText(two, File.ReadAllText(one), new UTF8Encoding(false));
        var expected = new Dictionary<string, string> { { one, Hash(one) }, { two, Hash(two) } };
        var items = new List<Tuple<string, IDictionary>> { Tuple.Create(one, Fixture()), Tuple.Create(two, Fixture()) };
        foreach (var item in items) Call("RestoreSubtitlePunctuation", item.Item2);
        var bytes = items.ToDictionary(item => item.Item1, item => File.ReadAllBytes(item.Item1));
        int calls = 0; Action fail = () => { if (++calls == 4) throw new InvalidOperationException("simulated editor opened"); };
        Reject(() => Call("SaveSubtitleJsonsChecked", items, 0, expected, fail, "standard_punctuation"), "Mid-batch interruption fails");
        foreach (var item in items) Check(bytes[item.Item1].SequenceEqual(File.ReadAllBytes(item.Item1)), "Partial batch rolls back to exact original bytes");
        File.AppendAllText(two, " "); string external = Hash(two);
        Reject(() => Call("SaveSubtitleJsonsChecked", items, 0, expected, null, "standard_punctuation"), "Stale preview rejected before writing");
        Check(Hash(one) == expected[one] && Hash(two) == external, "External edit never overwritten by rollback");
        File.WriteAllBytes(two, bytes[two]);
        Call("SaveSubtitleJsonsChecked", items, 0, expected, null, "standard_punctuation");
        foreach (var item in items) Check(Same(item.Item2, json.DeserializeObject(File.ReadAllText(item.Item1))), "Restored files verify after write");
        Check(Directory.GetFiles(root, "*.before_standard_punctuation_*.bak").Length >= 4, "Backups kept and uniquely named");
        var own = Path.Combine(root, "single"); Directory.CreateDirectory(own); File.WriteAllText(Path.Combine(own, "draft_content.json"), "{}");
        Check(((IEnumerable<string>)Call("PunctuationDraftDirectories", own)).Single() == own, "Single draft selected directly");
        Check(((IEnumerable<string>)Call("PunctuationDraftDirectories", root)).Single() == own, "Root finds immediate drafts only");
    }
    static void LongSubtitleSplit(string root) {
        const string text = "Starting tonight, The Vault doesn't make its rules by chopping off fingers.";
        Check((int)Call("SubtitleLineCount", text, 24, 12) == 4, "Screenshot caption wraps to four estimated lines");
        Check((int)Call("SubtitleLineCount", "While you're at it, hand over the ledger in the drawer to the police too.", 24, 12) == 4,
            "Spaces consume line width when estimating an unmodified draft");
        Check((int)Call("SubtitleLineCount", "When the police come, this is breaking and entering and kidnapping!", 22, 12) == 4,
            "Narrow subtitle frames can use the calibrated default");
        Check((int)Call("SubtitleLineCount", "You don't think that's a lot more interesting than an engagement?", 24, 12) == 3, "Three-line example remains unchanged");
        var data = Fixture(); var original = Clone(data);
        var mats = (IList)((IDictionary)data["materials"])["texts"];
        var caption = (IDictionary)mats[0];
        caption["content"] = json.Serialize(Obj("text", text, "styles", new[] { Obj("range", new[] { 0, text.Length }, "font", "Noto Sans Bold") }));
        caption["base_content"] = Obj("text", text, "styles", new[] { Obj("range", new[] { 0, text.Length }, "font", "Noto Sans Bold") });
        caption["recognize_text"] = text;
        caption["translate_original_text"] = text;
        caption["words"] = Obj(); caption["current_words"] = Obj();
        var parameters = new object[] { data, 24, 12, 0 };
        Check((int)Call("SplitLongSubtitles", parameters) == 1 && (int)parameters[3] == 0, "Four-line subtitle becomes two cues");
        var tracks = (IList)data["tracks"];
        var segments = (IList)((IDictionary)tracks[0])["segments"];
        var result = (IList)((IDictionary)data["materials"])["texts"];
        var first = (IDictionary)result[0]; var second = (IDictionary)result[result.Count - 1];
        var firstText = (IDictionary)json.DeserializeObject((string)first["content"]);
        var secondText = (IDictionary)json.DeserializeObject((string)second["content"]);
        Check((string)firstText["text"] == "Starting tonight,", "Comma stays with the first cue when present");
        Check((string)secondText["text"] == "The Vault doesn't make its rules by chopping off fingers.", "Second cue starts after the comma and space");
        Check((string)first["id"] != (string)second["id"] && (string)((IDictionary)segments[1])["material_id"] == (string)second["id"], "New material and segment are linked independently");
        var firstTime = (IDictionary)((IDictionary)segments[0])["target_timerange"];
        var secondTime = (IDictionary)((IDictionary)segments[1])["target_timerange"];
        Check(Convert.ToInt64(firstTime["start"]) + Convert.ToInt64(firstTime["duration"]) == Convert.ToInt64(secondTime["start"]), "Split segments are contiguous");
        Check(Convert.ToInt64(firstTime["duration"]) + Convert.ToInt64(secondTime["duration"]) == 7654321, "Original caption duration is preserved");
        Check(Same(((IDictionary)segments[0])["clip"], ((IDictionary)((IList)((IDictionary)((IList)original["tracks"])[0])["segments"])[0])["clip"]), "Transform and scale remain unchanged");
        var styles = (IList)firstText["styles"]; var secondStyles = (IList)secondText["styles"];
        Check(Convert.ToInt32(((IList)((IDictionary)styles[0])["range"])[1]) == ((string)firstText["text"]).Length &&
            Convert.ToInt32(((IList)((IDictionary)secondStyles[0])["range"])[1]) == ((string)secondText["text"]).Length, "Style ranges match both new captions");
        Check(Same(result[1], ((IList)((IDictionary)original["materials"])["texts"])[1]), "Ordinary title remains unchanged");
        var repeat = new object[] { data, 24, 12, 0 };
        Check((int)Call("SplitLongSubtitles", repeat) == 0, "Splitting the same draft again is idempotent");
        var plainDraft = Path.Combine(root, "split-preview.json");
        File.WriteAllText(plainDraft, json.Serialize(Fixture()), new UTF8Encoding(false));
        var saved = new List<Tuple<string, IDictionary>> { Tuple.Create(plainDraft, data) };
        Call("SaveSubtitleJsonsChecked", saved, 0, new Dictionary<string, string> { { plainDraft, Hash(plainDraft) } }, null, "split_subtitles");
        Check(Same(data, json.DeserializeObject(File.ReadAllText(plainDraft, Encoding.UTF8))), "Split materials and segments verify after a real file write");
        Check(Directory.GetFiles(root, "*.before_split_subtitles_*.bak").Length == 1, "Split write keeps its own verified backup");

        var noComma = (IList)Call("SubtitleSlices", text.Replace(",", ""), 18, 12);
        Check((string)noComma[0].GetType().GetField("Text").GetValue(noComma[0]) == "Starting tonight The Vault doesn't make", "Without a comma, the center space follows make");

        const string commaExample = "Mr. Chase, when something good comes up, don't forget about us.";
        var commaSlices = (IList)Call("SubtitleSlices", commaExample, 18, 12);
        Check((string)commaSlices[0].GetType().GetField("Text").GetValue(commaSlices[0]) == "Mr. Chase, when something good comes up,", "Nearest central comma wins over earlier comma");
        Check((string)commaSlices[1].GetType().GetField("Text").GetValue(commaSlices[1]) == "don't forget about us.", "Comma split preserves remaining English words");

        var withoutSpace = Fixture(); var noSpaceMat = (IDictionary)((IList)((IDictionary)withoutSpace["materials"])["texts"])[0];
        string unbroken = new string('a', 100);
        noSpaceMat["content"] = json.Serialize(Obj("text", unbroken, "styles", new[] { Obj("range", new[] { 0, 100 }) }));
        var skipped = new object[] { withoutSpace, 24, 12, 0 };
        Check((int)Call("SplitLongSubtitles", skipped) == 0 && (int)skipped[3] == 1, "Unbroken English word is skipped instead of cut");
    }
    static void SplitVariants() {
        const string text = "Starting tonight, The Vault doesn't make its rules by chopping off fingers.";
        var data = Fixture();
        var material = (IDictionary)((IList)((IDictionary)data["materials"])["texts"])[0];
        material["content"] = json.Serialize(Obj("text", text, "styles", new[] {
            Obj("range", new[] { 0, 18 }, "font", "first"), Obj("range", new[] { 18, text.Length - 18 }, "font", "second") }));
        material["base_content"] = Obj("text", text.Replace(" ", ""), "styles", new[] { Obj("range", new[] { 0, text.Replace(" ", "").Length }) });
        material["recognize_text"] = text.Replace(" ", "");
        material["translate_original_text"] = text;
        var tokens = text.Split(' ');
        material["words"] = Obj("text", tokens, "start_time", Enumerable.Range(0, tokens.Length).Select(n => n * 500).ToArray(),
            "end_time", Enumerable.Range(0, tokens.Length).Select(n => n * 500 + 450).ToArray());
        material["current_words"] = Obj();
        var args = new object[] { data, 24, 12, 0 };
        Check((int)Call("SplitLongSubtitles", args) == 1, "Aligned word cache and unspaced recognized text can be split");
        var result = (IList)((IDictionary)data["materials"])["texts"];
        var first = (IDictionary)result[0]; var second = (IDictionary)result[result.Count - 1];
        var firstWords = (IDictionary)first["words"]; var secondWords = (IDictionary)second["words"];
        Check(((IList)firstWords["text"]).Count + ((IList)secondWords["text"]).Count == tokens.Length, "Every recognized word remains in one new cue");
        Check(Convert.ToInt64(((IList)secondWords["start_time"])[0]) <= 50, "Second cue rebases word timestamps");
        var firstContent = (IDictionary)json.DeserializeObject((string)first["content"]);
        var secondContent = (IDictionary)json.DeserializeObject((string)second["content"]);
        Check(((IList)firstContent["styles"]).Count == 1 && ((IList)secondContent["styles"]).Count == 1 &&
            (string)((IDictionary)((IList)firstContent["styles"])[0])["font"] == "first" &&
            (string)((IDictionary)((IList)secondContent["styles"])[0])["font"] == "second", "Inline style spans are clipped without flattening the style");
        Check((string)((IDictionary)first["base_content"])["text"] + (string)((IDictionary)second["base_content"])["text"] == text.Replace(" ", ""), "Base content stays aligned even if it originally has no spaces");

        var chinese = Fixture(); var caption = (IDictionary)((IList)((IDictionary)chinese["materials"])["texts"])[0];
        string sentence = string.Concat(Enumerable.Repeat("今夜我们一起寻找真相", 5));
        caption["content"] = json.Serialize(Obj("text", sentence, "styles", new[] { Obj("range", new[] { 0, sentence.Length }) }));
        caption["base_content"] = Obj("text", sentence); caption["recognize_text"] = sentence;
        caption["words"] = Obj(); caption["current_words"] = Obj();
        var chineseArgs = new object[] { chinese, 24, 12, 0 };
        Check((int)Call("SplitLongSubtitles", chineseArgs) >= 1, "Four-line Chinese text splits without spaces");
        var chineseTexts = (IList)((IDictionary)chinese["materials"])["texts"];
        var chineseSegments = (IList)((IDictionary)((IList)chinese["tracks"])[0])["segments"];
        string recovered = string.Concat(chineseSegments.Cast<object>().Select(item => (IDictionary)item)
            .Where(item => (string)item["material_id"] != "title")
            .Select(item => chineseTexts.Cast<object>().Select(value => (IDictionary)value).First(value => (string)value["id"] == (string)item["material_id"]))
            .Select(item => (string)((IDictionary)json.DeserializeObject((string)item["content"]))["text"]));
        Check(recovered == sentence, "Chinese split retains every character");
    }
    static void RealDraft(string copy, string report) {
        Check(File.Exists(Path.Combine(copy, "XM-TEST-COPY")), "Only marked disposable samples may be changed");
        var items = (List<Tuple<string, IDictionary>>)Call("FindSubtitleJsons", copy);
        Check(items.Count > 0, "Encrypted sample has subtitle data");
        var original = items.ToDictionary(item => item.Item1, item => Clone(item.Item2));
        var hashes = items.ToDictionary(item => item.Item1, item => Hash(item.Item1));
        int count = 0; foreach (var item in items) count += (int)Call("RestoreSubtitlePunctuation", item.Item2);
        Check(count > 0, "Real sample contains protected punctuation");
        Call("SaveSubtitleJsonsChecked", items, 0, hashes, null, "standard_punctuation");
        var after = (List<Tuple<string, IDictionary>>)Call("FindSubtitleJsons", copy);
        foreach (var item in after) {
            Check(Same(items.First(x => x.Item1 == item.Item1).Item2, item.Item2), "Encrypted save/load preserves normalized content exactly");
            Check(Same(original[item.Item1]["tracks"], item.Item2["tracks"]), "Real timing and styles remain unchanged");
            Check(Same(original[item.Item1]["new_version"], item.Item2["new_version"]), "No draft version change");
            Check((int)Call("RestoreSubtitlePunctuation", item.Item2) == 0, "Real sample has no remaining protected marks in subtitle fields");
        }
        File.WriteAllText(report, json.Serialize(Obj("changedSubtitleRecords", count, "files", items.Count, "schema", items[0].Item2["new_version"], "readbackVerified", true, "timelinePreserved", true, "idempotent", true)), new UTF8Encoding(false));
    }
    static void RealSplitPreview(string directory) {
        var items = (List<Tuple<string, IDictionary>>)Call("FindSubtitleJsons", directory);
        Check(items.Count == 2, "Unmodified draft and timeline both contain subtitle data");
        foreach (var item in items) {
            var original = Clone(item.Item2);
            var parameters = new object[] { item.Item2, 22, 12, 0 };
            Check((int)Call("SplitLongSubtitles", parameters) >= 2 && (int)parameters[3] == 0, "Real draft detects both four-line captions");
            Check(!Same(original, item.Item2), "Real draft preview changes only the in-memory copy");
        }
    }
    [STAThread] static int Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length == 3 && args[0] == "--draft-io") return JianYingDraftIO.Worker(args[1], args[2]);
        if (args.Length == 4 && args[0] == "--draft-io-native") return JianYingDraftIO.NativeWorker(args[1], args[2], args[3]);
        string root = Path.Combine(Path.GetTempPath(), "xm-punctuation-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        var output = Console.Out; Console.SetOut(new StringWriter());
        try {
            engine = new JianYingEngine(Path.Combine(root, "profile"));
            Core(root); LongSubtitleSplit(root); SplitVariants(); if (args.Length == 2) RealDraft(Path.GetFullPath(args[0]), Path.GetFullPath(args[1]));
            if (args.Length == 1) RealSplitPreview(Path.GetFullPath(args[0]));
            output.WriteLine("Punctuation checks passed: " + checks); return 0;
        } catch (Exception error) { output.WriteLine(error); return 1; }
        finally { if (engine != null) engine.Close(); Console.SetOut(output); Directory.Delete(root, true); }
    }
}
