using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Text.RegularExpressions;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private Dictionary<string, object> wmSettings = J.Obj("mode", "image", "watermarkText", "内部样片 · 严禁外传", "watermarkImage", "builtin", "position", "fullscreen", "opacity", 1.0, "scale", .28, "size", "original", "crf", 23, "audioMode", "auto", "outputDir", "", "suffix", "样片");
        private readonly List<Dictionary<string, object>> wmJobs = new List<Dictionary<string, object>>();
        private bool wmRunning, wmCancelled;
        private Task wmTask;
        private Dictionary<string, object> wmCurrent;
        private void InitWatermark() { try { foreach (var item in J.Map(J.Read(Path.Combine(DataDir, "watermark", "settings", "watermark.json"), null))) if (wmSettings.ContainsKey(item.Key)) wmSettings[item.Key] = item.Value; } catch (Exception error) { Log(error.Message); } }
        private object WatermarkState() { return J.Obj("engine", "windows-media-foundation-hw", "running", wmRunning, "settings", wmSettings, "jobs", wmJobs.ToArray(), "totalCount", wmJobs.Count, "completedCount", wmJobs.Count(x => J.Str(x, "status") == "done"), "errorCount", wmJobs.Count(x => J.Str(x, "status") == "error"), "activeJobId", J.Str(wmCurrent, "id"), "activeFileName", J.Str(wmCurrent, "fileName"), "overallProgress", wmJobs.Count == 0 ? 0 : (int)wmJobs.Average(x => J.Str(x, "status") == "done" ? 100 : J.Num(x, "progress"))); }
        private object EmitWatermark() { object state = WatermarkState(); Emit("bos:watermark-state", state); return state; }
        private void WatermarkProgress(object state) { if (wmCurrent != null) { wmCurrent["progress"] = Math.Max(0, Math.Min(100, J.Num(state, "progress"))); EmitWatermark(); } }
        private string WatermarkOutput(string input, bool sourceDirectory) {
            string folder = sourceDirectory ? "" : J.Str(wmSettings, "outputDir"); if (folder.Length == 0) folder = Path.GetDirectoryName(input); Directory.CreateDirectory(folder);
            string stem = SafeName(Path.GetFileNameWithoutExtension(input) + J.Str(wmSettings, "suffix", "样片"));
            for (int i = 0; i < 1000; i++) { string file = Path.Combine(folder, stem + (i == 0 ? "" : " (" + i + ")") + ".mp4"); if (!File.Exists(file) && !file.Equals(input, StringComparison.OrdinalIgnoreCase)) return file; }
            throw new Exception("同名文件过多，请更换输出目录。");
        }
        private async Task<object> WatermarkAction(string action, object value) {
            if (action == "state") return WatermarkState();
            if (action == "choose-videos" || action == "add-videos") {
                var files = action == "choose-videos" ? ChooseFiles("视频|*.mp4;*.mov;*.mkv;*.avi;*.m4v;*.webm") : J.Arr(value).Select(Convert.ToString).ToArray();
                if (files.Length > 100) throw new Exception("一次最多添加100个视频。");
                foreach (string file in files) {
                    if (!Path.IsPathRooted(file) || !File.Exists(file) || !Regex.IsMatch(file, @"\.(mp4|mov|mkv|avi|m4v|webm)$", RegexOptions.IgnoreCase)) throw new Exception("请选择有效的视频文件。");
                    if (wmJobs.Any(x => J.Str(x, "inputPath") == file && new[] { "pending", "processing" }.Contains(J.Str(x, "status")))) continue;
                    wmJobs.Add(J.Obj("id", Guid.NewGuid().ToString("N"), "inputPath", file, "fileName", Path.GetFileName(file), "sizeBytes", new FileInfo(file).Length, "outputPath", "", "status", "pending", "progress", 0, "error", ""));
                }
            } else if (action == "choose-image") { var files = ChooseFiles("水印图片|*.png;*.jpg;*.jpeg;*.webp;*.bmp"); if (files.Length > 0) wmSettings["watermarkImage"] = files[0]; }
            else if (action == "choose-output-dir") { string folder = ChooseFolder(); if (folder.Length > 0) wmSettings["outputDir"] = folder; }
            else if (action == "update-settings") { foreach (var item in J.Map(value)) if (wmSettings.ContainsKey(item.Key)) wmSettings[item.Key] = item.Value; wmSettings["opacity"] = Math.Max(.05, Math.Min(1, J.Num(wmSettings, "opacity", 1))); wmSettings["scale"] = Math.Max(.08, Math.Min(.8, J.Num(wmSettings, "scale", .28))); wmSettings["crf"] = Math.Max(15, Math.Min(35, J.Num(wmSettings, "crf", 23))); }
            else if (action == "remove-job") wmJobs.RemoveAll(x => J.Str(x, "id") == Convert.ToString(value) && J.Str(x, "status") != "processing");
            else if (action == "clear-jobs") wmJobs.RemoveAll(x => J.Str(x, "status") != "processing" && (Convert.ToString(value) == "all" || new[] { "done", "error", "cancelled" }.Contains(J.Str(x, "status"))));
            else if (action == "retry-failed") foreach (var item in wmJobs.Where(x => new[] { "error", "cancelled" }.Contains(J.Str(x, "status")))) { item["status"] = "pending"; item["progress"] = 0; item["error"] = ""; }
            else if (action == "start" && !wmRunning) { wmRunning = true; wmCancelled = false; wmTask = RunWatermarks(); }
            else if (action == "cancel") { wmCancelled = true; if (wmRunning) await watermarkEngine.Call("cancel", null, false, 30000, true); }
            else if (action == "open-job") { var job = wmJobs.Find(x => J.Str(x, "id") == Convert.ToString(value)); string file = J.Str(job, "outputPath"); if (!File.Exists(file)) throw new Exception("成片不存在。"); System.Diagnostics.Process.Start("explorer.exe", "/select," + J.Quote(file)); }
            J.Save(Path.Combine(DataDir, "watermark", "settings", "watermark.json"), wmSettings); return EmitWatermark();
        }
        private async Task RunWatermarks() {
            try {
                while (!wmCancelled && !Exiting) {
                    wmCurrent = wmJobs.Find(x => J.Str(x, "status") == "pending"); if (wmCurrent == null) break;
                    var job = wmCurrent; string temp = "";
                    try {
                        var args = new Dictionary<string, object>(wmSettings); string dest = WatermarkOutput(J.Str(job, "inputPath"), J.Bool(job, "sourceDirectory"));
                        temp = Path.Combine(Path.GetDirectoryName(dest), ".xm-" + Guid.NewGuid().ToString("N") + ".mp4");
                        args["input"] = job["inputPath"]; args["output"] = temp;
                        if (J.Str(args, "mode") == "text") args["watermarkImage"] = "";
                        else if (J.Str(args, "watermarkImage") == "builtin") args["watermarkImage"] = Path.Combine(BaseDir, "resources", "watermark", "watermark.png");
                        job["status"] = "processing"; job["outputPath"] = dest; EmitWatermark();
                        var result = await watermarkEngine.Call("process", args, false, 24 * 60 * 60 * 1000, true);
                        if (wmCancelled) throw new OperationCanceledException();
                        if (!File.Exists(temp) || new FileInfo(temp).Length == 0) throw new Exception("未生成有效成片。");
                        File.Move(temp, dest); job["status"] = "done"; job["progress"] = 100; job["elapsedMs"] = J.Get(result, "elapsedMs", 0);
                    } catch (Exception error) { job["status"] = wmCancelled ? "cancelled" : "error"; job["error"] = error.Message; }
                    finally { if (temp.Length > 0 && File.Exists(temp)) File.Delete(temp); wmCurrent = null; EmitWatermark(); }
                }
            } finally { wmRunning = false; wmCurrent = null; EmitWatermark(); Notify(wmCancelled ? "水印处理已停止" : "水印处理完成"); }
        }
    }
}
