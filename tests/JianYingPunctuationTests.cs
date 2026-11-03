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

        string splitRoot = Path.Combine(root, "split-drafts");
        string upperDir = Path.Combine(splitRoot, "血色女王11上");
        string upperTl = Path.Combine(upperDir, "Timelines", "tl1");
        Directory.CreateDirectory(upperTl);
        var upperContent = Obj("duration", 117433333L, "config", Obj("export_range", Obj("duration", 56133333L)), "tracks", new object[0]);
        File.WriteAllText(Path.Combine(upperDir, "draft_content.json"), json.Serialize(upperContent), new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(upperDir, "draft_content.json.bak"), json.Serialize(upperContent), new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(upperTl, "draft_content.json"), json.Serialize(upperContent), new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(upperTl, "template.json"), json.Serialize(upperContent), new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(upperDir, "draft_meta_info.json"), json.Serialize(Obj("draft_name", "血色女王11上", "draft_fold_path", upperDir.Replace('\\', '/'), "draft_id", "OLD-ID")), new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(splitRoot, "root_meta_info.json"), json.Serialize(Obj("all_draft_store", new[] { Obj("draft_name", "血色女王11上", "draft_fold_path", upperDir.Replace('\\', '/'), "draft_id", "OLD-ID") }, "draft_ids", 1)), new UTF8Encoding(false));

        typeof(JianYingEngine).GetField("_draftDir", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(engine, splitRoot);
        Call("RunSplitUpperLowerDrafts", 0);
        string lowerDir = Path.Combine(splitRoot, "血色女王11下");
        Check(Directory.Exists(lowerDir), "Lower draft folder XXX下 created");
        var lowerData = (IDictionary)json.DeserializeObject(File.ReadAllText(Path.Combine(lowerDir, "draft_content.json"), Encoding.UTF8));
        var lowerEr = (IDictionary)((IDictionary)lowerData["config"])["export_range"];
        Check(Convert.ToInt64(lowerEr["start"]) == 56133333L && Convert.ToInt64(lowerEr["duration"]) == 61300000L, "Out-point of XXX上 becomes in-point of XXX下 with remaining duration");
        var lowerTlData = (IDictionary)json.DeserializeObject(File.ReadAllText(Path.Combine(lowerDir, "Timelines", "tl1", "draft_content.json"), Encoding.UTF8));
        var lowerTlEr = (IDictionary)((IDictionary)lowerTlData["config"])["export_range"];
        Check(Convert.ToInt64(lowerTlEr["start"]) == 56133333L && Convert.ToInt64(lowerTlEr["duration"]) == 61300000L, "Timeline draft_content.json export_range updated");
        var lowerMeta = (IDictionary)json.DeserializeObject(File.ReadAllText(Path.Combine(lowerDir, "draft_meta_info.json"), Encoding.UTF8));
        Check((string)lowerMeta["draft_name"] == "血色女王11下" && (string)lowerMeta["draft_id"] != "OLD-ID", "draft_meta_info updated with new name and ID");
        var rootMetaAfter = (IDictionary)json.DeserializeObject(File.ReadAllText(Path.Combine(splitRoot, "root_meta_info.json"), Encoding.UTF8));
        Check(((IList)rootMetaAfter["all_draft_store"]).Count == 2, "root_meta_info registered XXX下");
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
    [STAThread] static int Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length == 3 && args[0] == "--draft-io") return JianYingDraftIO.Worker(args[1], args[2]);
        if (args.Length == 4 && args[0] == "--draft-io-native") return JianYingDraftIO.NativeWorker(args[1], args[2], args[3]);
        string root = Path.Combine(Path.GetTempPath(), "xm-punctuation-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        var output = Console.Out; Console.SetOut(new StringWriter());
        try {
            engine = new JianYingEngine(Path.Combine(root, "profile"));
            Core(root); if (args.Length == 2) RealDraft(Path.GetFullPath(args[0]), Path.GetFullPath(args[1]));
            output.WriteLine("Punctuation checks passed: " + checks); return 0;
        } catch (Exception error) { output.WriteLine(error); return 1; }
        finally { if (engine != null) engine.Close(); Console.SetOut(output); Directory.Delete(root, true); }
    }
}
