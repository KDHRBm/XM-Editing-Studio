using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Web.Script.Serialization;

internal static class JianYingNativeTests
{
    private static JianYingEngine engine;
    private static int checks;
    private static object Call(string name, params object[] args) {
        try { return typeof(JianYingEngine).GetMethod(name, BindingFlags.Instance | BindingFlags.Static | BindingFlags.NonPublic).Invoke(engine, args); }
        catch (TargetInvocationException ex) { throw ex.InnerException; }
    }
    private static object Field(string name) { return typeof(JianYingEngine).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(engine); }
    private static void Set(string name, object value) { typeof(JianYingEngine).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(engine, value); }
    private static void Check(bool value, string name) { if (!value) throw new Exception(name); checks++; }
    private static void Reject(Action action, string name) { bool failed = false; try { action(); } catch (InvalidOperationException) { failed = true; } Check(failed, name); }
    private static Dictionary<string, object> Args(params object[] pairs) { var result = new Dictionary<string, object>(); for (int i = 0; i < pairs.Length; i += 2) result[(string)pairs[i]] = pairs[i + 1]; return result; }
    private static void Wait(Func<bool> ready) { var until = DateTime.UtcNow.AddSeconds(5); while (!ready()) { if (DateTime.UtcNow > until) throw new Exception("Timed out"); Thread.Sleep(10); } }
    private static string Scope(string heading) { return "{\"heading\":{\"text\":\"" + heading + "\",\"box\":[200,150,230,300]},\"region\":[240,150,800,800]}"; }
    private static string Card(int index) { int row = index / 5, col = index % 5; return "{\"kind\":\"draft\",\"name\":\"草稿" + index + "\",\"bounds\":{\"left\":" + (col * 190) + ",\"right\":" + (col * 190 + 150) + ",\"top\":" + (row * 300) + ",\"bottom\":" + (row * 300 + 200) + "}}"; }
    private static void Record(bool wrongToken, bool fail) {
        Call("OnKeyF8");
        Wait(() => Field("_recordingCapture") != null);
        var slot = Field("_recordingCapture"); var type = slot.GetType();
        string id = (string)type.GetField("Id").GetValue(slot), token = (string)type.GetField("Token").GetValue(slot);
        if (wrongToken) {
            engine.Dispatch("recording_capture_ready", Args("id", id, "token", "old", "error", ""));
            Check(!((ManualResetEventSlim)type.GetField("Ready").GetValue(slot)).IsSet, "stale capture token ignored");
            Check((bool)engine.Snapshot()["recording"], "snapshot responds while waiting for capture");
        }
        engine.Dispatch("recording_capture_ready", Args("id", id, "token", token, "error", fail ? "hide failed" : ""));
        Wait(() => Field("_recordingCapture") == null);
    }
    [STAThread]
    public static int Main(string[] args) {
        if (args.Length == 3 && args[0] == "--draft-io") { Console.InputEncoding = new System.Text.UTF8Encoding(false); Console.OutputEncoding = new System.Text.UTF8Encoding(false); return JianYingDraftIO.Worker(args[1], args[2]); }
        if (args.Length == 4 && args[0] == "--draft-io-native") { Console.InputEncoding = new System.Text.UTF8Encoding(false); Console.OutputEncoding = new System.Text.UTF8Encoding(false); return JianYingDraftIO.NativeWorker(args[1], args[2], args[3]); }
        var output = Console.Out;
        Console.SetOut(TextWriter.Synchronized(new StringWriter()));
        string root = Path.Combine(Path.GetTempPath(), "xm-native-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try {
            engine = new JianYingEngine(root);
            string rememberedDrafts = Path.Combine(root, "草稿目录"), rememberedSrt = Path.Combine(root, "字幕目录");
            Directory.CreateDirectory(rememberedDrafts); Directory.CreateDirectory(rememberedSrt);
            engine.Dispatch("paths", Args("draftDir", rememberedDrafts, "subtitleOutput", rememberedSrt));
            engine.Close(); engine = new JianYingEngine(root);
            Check((string)engine.Snapshot()["draftDir"] == rememberedDrafts && (string)engine.Snapshot()["subtitleOutput"] == rememberedSrt, "subtitle directories survive engine restart");
            string other = Path.Combine(root, "子文件夹"); Directory.CreateDirectory(other);
            string droppedA = Path.Combine(root, "第1集.mp4"), droppedB = Path.Combine(other, "第1集.mp4");
            File.WriteAllText(droppedA, "a"); File.WriteAllText(droppedB, "b");
            engine.Dispatch("files", Args("files", new[] { droppedA, droppedB }));
            Call("RegexPreview", "", "标题_第1集");
            Check(((List<Dictionary<string, object>>)Field("_plan")).Count == 2, "dropped files across directories retain distinct rename targets");
            engine.Dispatch("files", Args("files", new string[0]));
            var scope = Call("ParseScope", Scope("草稿 (13)"), 1920, 1080);
            string cards = "{\"visibleCount\":13,\"drafts\":[" + string.Join(",", Enumerable.Range(0, 13).Select(Card)) + "]}";
            var parsed = (List<Tuple<int, int, string>>)Call("ParseCards", cards, scope);
            Check(parsed.Count == 13, "all 13 drafts across rows retained");
            Check(Call("ParseScope", Scope("草稿"), 1920, 1080) != null, "heading without count");
            Check(Call("ParseScope", Scope("本地草稿 / 项目"), 1920, 1080) != null, "folder breadcrumb");
            Check(Call("ParseScope", "```json\r\n" + Scope("本地草稿 / 错睡") + "\r\n```", 2531, 1422) != null, "Gemini fenced Chinese folder breadcrumb");
            Check(Call("ParseScope", Scope("本地草稿 / 错睡").Replace("[200,150,230,300]", "[333,50,345,70]").Replace("[240,150,800,800]", "[345,50,444,391]"), 2531, 1422) != null, "screenshot response geometry accepted");
            Reject(() => Call("ParseScope", Scope("错睡"), 2531, 1422), "folder name alone cannot authorize clicks");
            Reject(() => Call("ParseScope", Scope("专业升级"), 2531, 1422), "promotional cards above drafts excluded");
            Reject(() => Call("ParseScope", Scope("开始创作"), 1920, 1080), "feature section rejected");
            Reject(() => Call("ParseScope", Scope("草稿").Replace("[240,150,800,800]", "[100,150,800,800]"), 1920, 1080), "region above heading rejected");
            Reject(() => Call("ParseCards", cards.Replace("\"visibleCount\":13", "\"visibleCount\":8"), scope), "incomplete count rejected");
            Reject(() => Call("ParseCards", cards.Replace("\"visibleCount\":13", "\"visibleCount\":13.1"), scope), "fractional count rejected");
            Reject(() => Call("ParseCards", "{\"drafts\":[" + Card(0).Replace("\"right\":150", "\"right\":0") + "]}", scope), "reversed bounds rejected");
            var folders = (List<Tuple<int, int, string>>)Call("ParseCards", "{\"drafts\":[" + Card(0).Replace("\"draft\"", "\"folder\"") + "]}", scope);
            Check(folders.Count == 0, "folder tiles excluded");
            var multiline = (List<Tuple<int, int, string>>)Call("ParseCards", "{\"drafts\":[" + Card(0).Replace("草稿0", "草稿\n0") + "]}", scope);
            Check(multiline[0].Item3 == "草稿 0", "Gemini literal newline normalized");
            Set("_draftScope", scope); Set("_drafts", parsed);
            var res = (int[])Call("GetScreenResolution");
            Set("_draftScope", Call("ParseScope", Scope("草稿 (13)"), res[0], res[1]));
            Set("_drafts", (List<Tuple<int, int, string>>)Call("ParseCards", cards, Field("_draftScope")));
            Call("ValidateDraftQueue"); checks++;
            Set("_drafts", new List<Tuple<int, int, string>> { Tuple.Create(0, 0, "feature") });
            Reject(() => Call("ValidateDraftQueue"), "out of region export rejected");
            // Crop the original captured image, even if another window is now on screen.
            using (var bmp = new Bitmap(100, 100)) using (var g = Graphics.FromImage(bmp)) using (var ms = new MemoryStream()) {
                g.Clear(Color.Red); g.FillRectangle(Brushes.Blue, 50, 0, 50, 100); bmp.Save(ms, ImageFormat.Png);
                string cropped = (string)Call("CaptureCropJpegBase64", Convert.ToBase64String(ms.ToArray()), new Rectangle(100, 0, 100, 200), 200, 200);
                using (var bytes = new MemoryStream(Convert.FromBase64String(cropped))) using (var image = new Bitmap(bytes)) Check(image.Width == 50 && image.Height == 100 && image.GetPixel(25, 50).B > 200, "crop uses original image and scales correctly");
            }
            engine.Dispatch("wizard", Args());
            Check(((IDictionary)engine.Snapshot()["recordingProgress"])["stage"].Equals("preparing"), "recording preparing protocol");
            Record(true, true);
            Check(((IDictionary)engine.Snapshot()["recordingProgress"])["stage"].Equals("retry") && Field("_recState").Equals("export"), "failed hide remains retryable");
            Record(false, false); Record(false, false); Record(false, false);
            Check(!(bool)engine.Snapshot()["recording"] && (bool)engine.Snapshot()["coordinatesReady"], "F8 completes template without foreground focus");
            Check(((IDictionary)engine.Snapshot()["recordingProgress"])["completed"].Equals(3), "recording completion count");
            string template = (string)engine.Snapshot()["templateId"];
            engine.Dispatch("wizard", Args()); Call("OnKeyF8"); Wait(() => Field("_recordingCapture") != null);
            Call("OnKeyF10"); Wait(() => Field("_recordingCapture") == null);
            Check(((IDictionary)engine.Snapshot()["recordingProgress"])["stage"].Equals("cancelled"), "F10 cancels pending capture");
            Check(engine.Snapshot()["templateId"].Equals(template), "cancel retains previous template");
            Set("_exportMode", "wait_close"); engine.Dispatch("wizard", Args());
            Record(false, false); Record(false, false);
            Check(((IDictionary)engine.Snapshot()["recordingProgress"])["skipAvailable"].Equals(true), "wait mode skip offered");
            Call("OnKeyF9"); Record(false, false); Record(false, false);
            Check(((IDictionary)engine.Snapshot()["recordingProgress"])["completed"].Equals(4), "four-step recording completes");
            Call("BeginExportProgress", 1, "return_home", parsed, (Dictionary<string, int[]>)Field("_coords"));
            Call("ExportStep", 1, "草稿1", true);
            Set("_exportActive", true); Call("StopOperation", "F10");
            Call("FinishExportProgress", "return_home", new OperationCanceledException());
            var export = (IDictionary)engine.Snapshot()["exportProgress"];
            Check(export["stage"].Equals("cancelled") && export["total"].Equals(12) && export["completed"].Equals(1), "export interrupted counts retained");
            Check(Convert.ToString(export["message"]).Contains("F10") && Convert.ToString(export["message"]).Contains("仍由剪映处理"), "background exports explained");
            Set("_exportActive", false);
            // A changed file cannot be renamed using an obsolete preview.
            string media = Path.Combine(root, "第1集.mp3"); File.WriteAllText(media, "before");
            Call("RegexPreview", root, "作品第1集"); File.AppendAllText(media, "changed");
            Reject(() => Call("ValidateRenamePlan", false), "stale rename preview rejected");
            var json = new JavaScriptSerializer();
            var subtitle = (IDictionary)json.DeserializeObject("{\"materials\":{\"texts\":[{\"id\":\"sub\",\"type\":\"subtitle\",\"content\":{\"text\":\"Mr. Harris, wait... ¡Sí!\"}},{\"id\":\"title\",\"type\":\"text\",\"content\":{\"text\":\"Title\"}}]},\"tracks\":[{\"type\":\"text\",\"segments\":[{\"material_id\":\"sub\",\"target_timerange\":{\"start\":1250000,\"duration\":2000000}}]},{\"type\":\"text\",\"segments\":[{\"material_id\":\"title\"}]}]}");
            var lines = (List<string>)Call("ExtractSubtitleLines", subtitle);
            Check(lines.Count == 4 && lines[1] == "00:00:01,250 --> 00:00:03,250" && lines[2] == "Mr. Harris, wait... ¡Sí!", "subtitle punctuation and timing preserved; title excluded");
            Check(Call("SetSubtitleTracksHidden", subtitle, true).Equals(1), "only subtitle track hidden");
            string draftRoot = Path.Combine(root, "draft"); string timeline = Path.Combine(draftRoot, "Timelines", "one"); Directory.CreateDirectory(timeline);
            string first = Path.Combine(draftRoot, "draft_content.json"), second = Path.Combine(timeline, "draft_content.json");
            string originalJson = json.Serialize(subtitle); File.WriteAllText(first, originalJson); File.WriteAllText(second, originalJson);
            var copies = (List<Tuple<string, IDictionary>>)Call("FindSubtitleJsons", draftRoot);
            Check(copies.Count == 2, "root and timeline both loaded");
            Call("SetSubtitleTracksHidden", copies[0].Item2, false); Call("SetSubtitleTracksHidden", copies[1].Item2, false);
            Set("_stopFlag", false);
            int generation = (int)Field("_operationGeneration");
            File.SetAttributes(second, FileAttributes.ReadOnly);
            bool writeFailed = false;
            try { Call("SaveSubtitleJsons", copies, generation); } catch { writeFailed = true; }
            finally { File.SetAttributes(second, FileAttributes.Normal); }
            Check(writeFailed && File.ReadAllText(first) == originalJson && File.ReadAllText(second) == originalJson, "partial subtitle write rolls back all copies");
            Call("SaveSubtitleJsons", copies, generation);
            Check(File.ReadAllText(first) != originalJson && Directory.GetFiles(draftRoot, "*.bak").Length > 0, "successful subtitle update retains backup");
            Check((bool)Call("SameJson", json.DeserializeObject("{\"a\":1,\"b\":[true]}"), json.DeserializeObject("{\"b\":[true],\"a\":1.0}")), "verification ignores key ordering and equivalent numbers");
            Check(!(bool)Call("SameJson", json.DeserializeObject("{\"a\":1}"), json.DeserializeObject("{\"a\":2}")), "verification detects changed values");
            var libs = new[] { Path.Combine(root, "11.7.5", "videoeditor.dll"), Path.Combine(root, "11.6.5", "videoeditor.dll") };
            var attempts = new List<string>();
            string selected = null;
            Func<string, string, string, Action, string, IDictionary> compatible = (mode, file, input, cancel, lib) => {
                attempts.Add(Path.GetFileName(Path.GetDirectoryName(lib)) + ":" + mode);
                if (lib == libs[0]) throw new InvalidOperationException("error 6");
                return Args("subtitle", "¡Sí! 中文字幕");
            };
            var readResult = JianYingDraftIO.RequestWithLibraries("read", first, null, () => {}, libs, compatible, lib => selected = lib);
            Check(selected == libs[1] && Convert.ToString(readResult["subtitle"]) == "¡Sí! 中文字幕" && attempts.SequenceEqual(new[] {"11.7.5:read", "11.6.5:read"}), "new interface failure falls back without changing Unicode");
            attempts.Clear();
            JianYingDraftIO.RequestWithLibraries("write", first, "{}", () => {}, libs, compatible, null);
            Check(attempts.SequenceEqual(new[] {"11.7.5:read", "11.6.5:read", "11.6.5:write"}), "writes only through successfully read library");
            int writeCalls = 0;
            Reject(() => JianYingDraftIO.RequestWithLibraries("write", first, "{}", () => {}, libs, (mode, file, input, cancel, lib) => {
                if (mode == "write") { writeCalls++; throw new InvalidOperationException("readback failed after write"); }
                return Args("ok", true);
            }, null), "write failure bubbles up for transactional rollback");
            Check(writeCalls == 1, "write failure never retries a second library");
            int cancelledCalls = 0; bool cancelled = false;
            try { JianYingDraftIO.RequestWithLibraries("read", first, null, () => {}, libs, (mode, file, input, cancel, lib) => { cancelledCalls++; throw new OperationCanceledException(); }, null); }
            catch (OperationCanceledException) { cancelled = true; }
            Check(cancelled && cancelledCalls == 1, "cancellation never triggers fallback");
            int invalidCalls = 0;
            Reject(() => JianYingDraftIO.RequestWithLibraries("write", first, "[]", () => {}, libs, (mode, file, input, cancel, lib) => { invalidCalls++; return Args(); }, null), "invalid write JSON rejected before native IO");
            Check(invalidCalls == 0, "invalid JSON does not start any worker");
            output.WriteLine("Native compatibility checks passed: " + checks);
            return 0;
        } catch (Exception ex) { output.WriteLine(ex.ToString()); return 1; }
        finally { if (engine != null) engine.Close(); Console.SetOut(output); foreach (var file in Directory.GetFiles(root, "*", SearchOption.AllDirectories)) File.SetAttributes(file, FileAttributes.Normal); Directory.Delete(root, true); }
    }
}
