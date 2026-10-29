using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;

// Opt-in real-draft check. Only modifies an explicitly marked disposable copy.
internal static class JianYingDraftIntegrationTests
{
    private static object Call(JianYingEngine engine, string name, params object[] args) {
        try { return typeof(JianYingEngine).GetMethod(name, BindingFlags.Instance | BindingFlags.Static | BindingFlags.NonPublic).Invoke(engine, args); }
        catch (TargetInvocationException ex) { throw ex.InnerException; }
    }
    private static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
    [STAThread]
    public static int Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length == 3 && args[0] == "--draft-io") return JianYingDraftIO.Worker(args[1], args[2]);
        if (args.Length == 4 && args[0] == "--draft-io-native") return JianYingDraftIO.NativeWorker(args[1], args[2], args[3]);
        if (args.Length != 2) throw new ArgumentException("Expected disposable draft directory and output report");
        string copy = Path.GetFullPath(args[0]), output = Path.GetFullPath(args[1]);
        Check(File.Exists(Path.Combine(copy, "XM-TEST-COPY")), "Refusing an unmarked original draft");
        var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        var writer = Console.Out;
        Console.SetOut(TextWriter.Synchronized(new StringWriter()));
        JianYingEngine engine = null;
        try {
            engine = new JianYingEngine(Path.Combine(Path.GetDirectoryName(output), "test-profile"));
            var copies = (List<Tuple<string, IDictionary>>)Call(engine, "FindSubtitleJsons", copy);
            Check(copies.Count == 2, "Expected main and timeline subtitle drafts");
            var lines = (List<string>)Call(engine, "ExtractSubtitleLines", copies[0].Item2);
            Check(lines.Count / 4 == 26, "Expected all 26 sample subtitle cues");
            var original = copies.ToDictionary(item => item.Item1, item => json.Serialize(item.Item2));
            foreach (var item in copies) Call(engine, "SetSubtitleTracksHidden", item.Item2, true);
            Call(engine, "SaveSubtitleJsons", copies, 0);
            var hidden = (List<Tuple<string, IDictionary>>)Call(engine, "FindSubtitleJsons", copy);
            foreach (var item in hidden) {
                Check(lines.SequenceEqual((List<string>)Call(engine, "ExtractSubtitleLines", item.Item2)), "Subtitle content/timing changed");
                Check((bool)Call(engine, "SameJson", copies.First(c => c.Item1 == item.Item1).Item2, item.Item2), "Encrypted write/read mismatch");
                Check(Convert.ToString(item.Item2["new_version"]) == "192.0.0", "Extraction must not downgrade the draft version");
                Call(engine, "SetSubtitleTracksHidden", item.Item2, false);
            }
            Call(engine, "SaveSubtitleJsons", hidden, 0);
            var visible = (List<Tuple<string, IDictionary>>)Call(engine, "FindSubtitleJsons", copy);
            foreach (var item in visible) Check((bool)Call(engine, "SameJson", hidden.First(c => c.Item1 == item.Item1).Item2, item.Item2), "Unhide roundtrip mismatch");
            // Simulate a timeline write failure after the main file was changed.
            string blocked = visible[1].Item1;
            var beforeFailure = visible.ToDictionary(item => item.Item1, item => File.ReadAllBytes(item.Item1));
            foreach (var item in visible) Call(engine, "SetSubtitleTracksHidden", item.Item2, true);
            File.SetAttributes(blocked, File.GetAttributes(blocked) | FileAttributes.ReadOnly);
            bool rejected = false;
            try { Call(engine, "SaveSubtitleJsons", visible, 0); } catch { rejected = true; }
            finally { File.SetAttributes(blocked, File.GetAttributes(blocked) & ~FileAttributes.ReadOnly); }
            Check(rejected, "Read-only timeline should fail");
            foreach (var item in visible) Check(beforeFailure[item.Item1].SequenceEqual(File.ReadAllBytes(item.Item1)), "Partial update did not roll back");
            string srt = Path.Combine(Path.GetDirectoryName(output), "睡错40.srt");
            File.WriteAllText(srt, string.Join("\n", lines), new UTF8Encoding(false));
            File.WriteAllText(output, json.Serialize(new {
                subtitleCues = lines.Count / 4, copies = copies.Count, hiddenReadbackVerified = true,
                unhideReadbackVerified = true, writeFailureRollbackVerified = true, schemaPreserved = "192.0.0", srt = srt,
                originalTextsAndTimingPreserved = true
            }), new UTF8Encoding(false));
            writer.WriteLine("Real encrypted draft extraction, hide, unhide and rollback passed; 26 cues.");
            return 0;
        } catch (Exception ex) { writer.WriteLine(ex.ToString()); return 1; }
        finally { if (engine != null) engine.Close(); Console.SetOut(writer); }
    }
}
