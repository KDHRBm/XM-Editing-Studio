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
    private static void ModeWaitAndRenameChecks(string root) {
        string config = Path.Combine(root, "settings.json");
        engine.Close();
        File.WriteAllText(config, "{\"export_mode\":\"return_home\",\"step_waits\":{\"open_draft\":12.3,\"export\":4.4}}");
        engine = new JianYingEngine(root);
        Check(((Dictionary<string,double>)engine.Snapshot()["waits"])["open_draft"] == 12.3, "legacy waits imported into return-home");
        engine.Dispatch("settings", Args("mode", "wait_close"));
        Check(((Dictionary<string,double>)engine.Snapshot()["waits"])["open_draft"] == 12.3, "legacy waits also imported into wait-close");
        engine.Dispatch("settings", Args("waits", Args("open_draft", 25.6)));
        engine.Dispatch("settings", Args("mode", "return_home"));
        Check(((Dictionary<string,double>)engine.Snapshot()["waits"])["open_draft"] == 12.3, "wait-close changes do not affect return-home");
        Reject(() => engine.Dispatch("settings", Args("mode", "wait_close", "waits", Args("open_draft", 3, "export", 700))), "invalid settings rejected atomically");
        Check((string)engine.Snapshot()["mode"] == "return_home", "invalid settings leave mode unchanged");
        engine.Dispatch("settings", Args("waitsMode", "wait_close", "waits", Args("confirm", 6.7)));
        Check((string)engine.Snapshot()["mode"] == "return_home", "editing a named profile does not switch active mode");
        engine.Close(); engine = new JianYingEngine(root);
        engine.Dispatch("settings", Args("mode", "wait_close"));
        var waits = (Dictionary<string,double>)engine.Snapshot()["waits"];
        Check(waits["open_draft"] == 25.6 && waits["confirm"] == 6.7 && waits["export"] == 4.4, "mode-specific waits survive restart, invalid request caused no partial writes");
        engine.Dispatch("settings", Args("mode", "return_home"));
        string dir = Path.Combine(root,"rename-cases"); Directory.CreateDirectory(dir);
        string a = Path.Combine(dir,"alpha.mp4"), b = Path.Combine(dir,"beta.mp4"); File.WriteAllText(a,"a"); File.WriteAllText(b,"b");
        File.WriteAllText(Path.Combine(dir,"统一.mp4"), "existing");
        engine.Dispatch("files", Args("files", new[] {a,b}));
        Call("FillAiRename", new object[] { new ArrayList {Args("old","alpha","new","统一"),Args("old","beta.mp4","new","统一")} });
        var plan = (List<Dictionary<string,object>>)Field("_plan");
        Check((string)plan[0]["new_name"] == "统一_2.mp4" && (string)plan[1]["new_name"] == "统一_3.mp4", "omitted extensions inherited and occupied/duplicate targets suffixed");
        Check(File.ReadAllText(a) == "a" && File.ReadAllText(Path.Combine(dir,"统一.mp4")) == "existing", "preview never renames or overwrites files");
        Reject(() => Call("FillAiRename", new object[] { new ArrayList { Args("old","alpha.mp4","new","changed.exe") } }), "explicit extension changes rejected");
        Reject(() => Call("FillAiRename", new object[] { new ArrayList { Args("old","../alpha.mp4","new","escape") } }), "AI path traversal rejected");
        string subtitle = Path.Combine(dir,"alpha.srt"); File.WriteAllText(subtitle,"subtitle");
        engine.Dispatch("files", Args("files", new[] {a,subtitle}));
        Reject(() => Call("FillAiRename", new object[] { new ArrayList {Args("old","alpha","new","title")} }), "ambiguous video/subtitle stems rejected");
        engine.Dispatch("files", Args("files", new[] {a,b}));
        Call("RegexPreview", "", "标题第7集");
        plan = (List<Dictionary<string,object>>)Field("_plan");
        Check(plan.Count == 2 && (string)plan[0]["new_name"] == "标题第7集.mp4" && (string)plan[1]["new_name"] == "标题第8集.mp4", "individually selected unnumbered files use template start number");
        engine.Dispatch("files", Args("files", new string[0]));
        Check(((List<Dictionary<string,object>>)Field("_plan")).Count == 0, "clear selection clears preview without deleting files");
    }
    private static string Scope(string heading) { return "{\"heading\":{\"text\":\"" + heading + "\",\"box\":{\"top\":200,\"left\":150,\"bottom\":230,\"right\":300}},\"region\":{\"top\":240,\"left\":150,\"bottom\":800,\"right\":800}}"; }
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
    private static void UseFakeRecording()
    {
        Set("_readCursor", new Func<Point>(() => {
            string step = Convert.ToString(Field("_recState"));
            return step == "draft_close" ? new Point(60, 80) : step == "close_btn" ? new Point(500, 350) : new Point(700, 120);
        }));
        Set("_recordingWindow", new Func<Point, int[]>(p => new[] { 0, 0, 1920, 1080, 96 }));
        Set("_captureButton", new Func<Point, string>(p => {
            using (var image = new Bitmap(81, 25)) using (var g = Graphics.FromImage(image)) using (var stream = new MemoryStream()) {
                g.Clear(Color.FromArgb(30, 30, 30)); g.DrawLine(Pens.White, 25, 5, 55, 20); image.Save(stream, ImageFormat.Png); return Convert.ToBase64String(stream.ToArray());
            }
        }));
    }
    private static void DraftHomeChecks()
    {
        var oldWindow = Field("_homeWindow"); var oldFrame = Field("_homeFrame"); var oldCapture = Field("_captureHome");
        var res = (int[])Call("GetScreenResolution");
        int w = 1920, h = 1080;
        var scope = Call("ParseScope", Scope("本地草稿 / Show A").Replace("\"right\":300", "\"right\":450"), w, h); var type = scope.GetType();
        var drafts = (List<Tuple<int, int, string>>)Call("ParseCards", "{\"visibleCount\":1,\"drafts\":[" + Card(0) + "]}", scope);
        type.GetField("Width").SetValue(scope, res[0]); type.GetField("Height").SetValue(scope, res[1]);
        var box = ((Dictionary<Point,Rectangle>)type.GetField("CardBoxes").GetValue(scope)).Values.First();
        var heading = (Rectangle)type.GetField("HeadingBox").GetValue(scope);
        var originalFrame = new[] {0,0,w,h,96}; int[] currentFrame = (int[])originalFrame.Clone();
        IntPtr currentWindow = new IntPtr(200); int captures = 0, reads = 0;
        type.GetField("WindowBounds").SetValue(scope, originalFrame); type.GetField("Window").SetValue(scope, new IntPtr(100));
        Set("_draftScope", scope); Set("_drafts", drafts); Set("_stopFlag", false);
        int gen = (int)Field("_operationGeneration");
        using (var scene = new Bitmap(w, h)) using (var g = Graphics.FromImage(scene)) using (var font = new Font("Arial", 14))
        {
            g.Clear(Color.FromArgb(30,30,30)); g.DrawString("Local drafts / Show A",font,Brushes.White,heading.Location);
            g.FillRectangle(Brushes.SteelBlue,box); g.FillEllipse(Brushes.Gold,Rectangle.Inflate(box,-30,-25));
            g.DrawLine(Pens.White,box.Left,box.Top,box.Right,box.Bottom);
            Action<string> title = text => {using(var brush=new SolidBrush(Color.FromArgb(30,30,30)))g.FillRectangle(brush,box.Left,box.Bottom,box.Width,36); g.DrawString(text,font,Brushes.White,box.Left,box.Bottom+2);};
            title("Episode 02");
            using (var stream = new MemoryStream()) {
                scene.Save(stream,ImageFormat.Png);
                Call("RememberDraftAnchors",scope,Convert.ToBase64String(stream.ToArray()),new Rectangle(0,0,w,h),96);
            }
            Set("_homeWindow",new Func<IntPtr>(() => currentWindow));
            Set("_homeFrame",new Func<IntPtr,int[]>(window => {reads++; if(window!=currentWindow)throw new InvalidOperationException("old HWND destroyed"); return (int[])currentFrame.Clone();}));
            Func<Rectangle,Bitmap> capture = area => {captures++; area.Offset(-currentFrame[0],-currentFrame[1]); return scene.Clone(area,PixelFormat.Format24bppRgb);};
            Set("_captureHome",capture);
            var point = new Point(drafts[0].Item1,drafts[0].Item2);
            try {
                Call("ValidateDraftQueue"); Check(reads==0,"queue does not dereference destroyed or minimized scan window");
                Check((Point)Call("WaitForDraftHome",drafts[0],gen,3,0.0)==point && captures==6,"same home on a new HWND requires two stable visual checks");
                Check((IntPtr)type.GetField("Window").GetValue(scope)==currentWindow,"confirmed replacement homepage is rebound");
                currentWindow=new IntPtr(300); currentFrame[0]=-80; currentFrame[1]=40;
                var moved = new Point(point.X-80,point.Y+40);
                Check((Point)Call("WaitForDraftHome",drafts[0],gen,3,0.0)==moved,"new homepage movement translates visual anchors and draft point");
                Check((Point)Call("WaitForDraftHome",drafts[0],gen,3,0.0)==moved && originalFrame.SequenceEqual((int[])type.GetField("WindowBounds").GetValue(scope)),"repeated rebind never translates original coordinates twice");
                int probes=0;
                Set("_homeWindow",new Func<IntPtr>(() => ++probes<=2 ? IntPtr.Zero : currentWindow));
                Check((Point)Call("WaitForDraftHome",drafts[0],gen,5,0.0)==moved,"temporary missing foreground during return-home waits then recovers");
                Set("_homeWindow",new Func<IntPtr>(() => currentWindow));
                Reject(()=>Call("WaitForDraftHome",drafts[0],gen,1,0.0),"one matching frame is insufficient");
                title("Episode 03");
                Reject(()=>Call("WaitForDraftHome",drafts[0],gen,2,0.0),"different draft title with identical cover is rejected");
                title("Episode 02");
                using(var brush=new SolidBrush(Color.FromArgb(30,30,30)))g.FillRectangle(brush,heading);
                g.DrawString("Local drafts / Show B",font,Brushes.White,heading.Location);
                Reject(()=>Call("WaitForDraftHome",drafts[0],gen,2,0.0),"another folder breadcrumb is rejected");
                using(var brush=new SolidBrush(Color.FromArgb(30,30,30)))g.FillRectangle(brush,heading);
                g.DrawString("Local drafts / Show A",font,Brushes.White,heading.Location);
                currentFrame[2]+=100;
                Reject(()=>Call("WaitForDraftHome",drafts[0],gen,2,0.0),"resized home is never accepted"); currentFrame[2]-=100;
                currentFrame[4]=144;
                Reject(()=>Call("WaitForDraftHome",drafts[0],gen,2,0.0),"changed DPI cannot reuse draft coordinates"); currentFrame[4]=96;
                Set("_captureHome",new Func<Rectangle,Bitmap>(area=>{var b=new Bitmap(area.Width,area.Height);using(var bg=Graphics.FromImage(b))bg.Clear(Color.FromArgb(30,30,30));return b;}));
                Reject(()=>Call("WaitForDraftHome",drafts[0],gen,2,0.0),"editor and blank loading panels cannot authorize draft clicks");
                Set("_captureHome",capture);
                int frameCalls=0;
                Set("_homeFrame",new Func<IntPtr,int[]>(window=>{if(++frameCalls==2)throw new InvalidOperationException("window closed during capture");return (int[])currentFrame.Clone();}));
                Reject(()=>Call("WaitForDraftHome",drafts[0],gen,2,0.0),"window loss during capture resets stable proof");
                Set("_homeFrame",new Func<IntPtr,int[]>(window=>(int[])currentFrame.Clone()));
                Set("_captureHome",new Func<Rectangle,Bitmap>(area=>{Set("_stopFlag",true);return capture(area);}));
                bool cancelled=false;try {Call("WaitForDraftHome",drafts[0],gen,4,.01);}catch(OperationCanceledException){cancelled=true;}
                Check(cancelled,"F10 interrupts return-home verification before clicking"); Set("_stopFlag",false);
            } finally {Set("_homeWindow",oldWindow);Set("_homeFrame",oldFrame);Set("_captureHome",oldCapture);Set("_stopFlag",false);}
        }
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
            ModeWaitAndRenameChecks(root);
            string rememberedDrafts = Path.Combine(root, "草稿目录"), rememberedSrt = Path.Combine(root, "字幕目录");
            Directory.CreateDirectory(rememberedDrafts); Directory.CreateDirectory(rememberedSrt);
            engine.Dispatch("paths", Args("draftDir", "\"" + rememberedDrafts + "\"", "subtitleOutput", "  " + rememberedSrt + "  "));
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
            string namedScope = "{\"heading\":{\"text\":\"本地草稿 / 志愿者\",\"box\":{\"left\":95,\"top\":355,\"right\":165,\"bottom\":376}},\"region\":{\"left\":100,\"top\":380,\"right\":620,\"bottom\":517}}";
            var namedScopeParsed = Call("ParseScope", namedScope, 2560, 1400);
            Check(((Rectangle)namedScopeParsed.GetType().GetField("Box").GetValue(namedScopeParsed)).Left == 243, "named header and region keep the leftmost draft despite a small region inset");
            Reject(() => Call("ParseScope", "{\"heading\":{\"text\":\"本地草稿 / 志愿者\",\"box\":[94,355,111,376]},\"region\":[112,380,304,517]}", 2560, 1400), "real transposed DeepSeek response cannot crop out early drafts");
            Reject(() => Call("ParseScope", namedScope.Replace("\"left\":100", "\"left\":300"), 2560, 1400), "region beginning several cards after heading is rejected");
            Check(Call("ParseScope", "```json\r\n" + Scope("本地草稿 / 错睡") + "\r\n```", 2531, 1422) != null, "Gemini fenced Chinese folder breadcrumb");
            Check(Call("ParseScope", Scope("本地草稿 / 错睡").Replace("\"top\":200,\"left\":150,\"bottom\":230,\"right\":300", "\"top\":333,\"left\":50,\"bottom\":345,\"right\":70").Replace("\"top\":240,\"left\":150,\"bottom\":800,\"right\":800", "\"top\":345,\"left\":50,\"bottom\":444,\"right\":391"), 2531, 1422) != null, "screenshot response geometry accepted");
            Reject(() => Call("ParseScope", Scope("错睡"), 2531, 1422), "folder name alone cannot authorize clicks");
            Reject(() => Call("ParseScope", Scope("专业升级"), 2531, 1422), "promotional cards above drafts excluded");
            Reject(() => Call("ParseScope", Scope("开始创作"), 1920, 1080), "feature section rejected");
            Reject(() => Call("ParseScope", Scope("草稿").Replace("\"top\":240", "\"top\":100"), 1920, 1080), "region above heading rejected");
            Reject(() => Call("ParseCards", cards.Replace("\"visibleCount\":13", "\"visibleCount\":8"), scope), "incomplete count rejected");
            Reject(() => Call("ParseCards", cards.Replace("\"visibleCount\":13", "\"visibleCount\":13.1"), scope), "fractional count rejected");
            Reject(() => Call("ParseCards", "{\"drafts\":[" + Card(0).Replace("\"right\":150", "\"right\":0") + "]}", scope), "reversed bounds rejected");
            var folders = (List<Tuple<int, int, string>>)Call("ParseCards", "{\"drafts\":[" + Card(0).Replace("\"draft\"", "\"folder\"") + "]}", scope);
            Check(folders.Count == 0, "folder tiles excluded");
            string pixelCard = "{\"coordinateSpace\":\"pixels\",\"imageWidth\":800,\"imageHeight\":400,\"visibleCount\":1,\"drafts\":[{\"kind\":\"draft\",\"name\":\"像素草稿\",\"bounds\":{\"left\":80,\"top\":40,\"right\":240,\"bottom\":120}}]}";
            string normalizedCard = pixelCard.Replace("pixels", "normalized_1000").Replace("\"left\":80", "\"left\":100").Replace("\"top\":40", "\"top\":100").Replace("\"right\":240", "\"right\":300").Replace("\"bottom\":120", "\"bottom\":300");
            Check(((List<Tuple<int,int,string>>)Call("ParseCards", pixelCard, scope))[0].Equals(((List<Tuple<int,int,string>>)Call("ParseCards", normalizedCard, scope))[0]), "pixel coordinates below 1000 are not mistaken for normalized coordinates");
            Call("ValidateCoordinateContract", pixelCard, new Size(800,400)); checks++;
            Reject(() => Call("ValidateCoordinateContract", pixelCard, new Size(1600,800)), "AI screenshot dimensions cannot silently change click coordinates");
            Reject(() => Call("ValidateCoordinateContract", cards, new Size(800,400)), "ambiguous coordinate units require AI correction");
            foreach (bool scanCards in new[] {false,true}) {
                string prompt = (string)Call("ScanPrompt",scanCards,new Size(1735,821),"缺少 coordinateSpace");
                string example = prompt.Substring(prompt.IndexOf('{'),prompt.LastIndexOf('}')-prompt.IndexOf('{')+1);
                Call("ValidateCoordinateContract",example,new Size(1735,821)); checks++;
                Check(prompt.Contains("result 内") && prompt.Contains("上一次完整回答未通过校验：缺少 coordinateSpace"),"both scan phases put the complete coordinate contract inside the result and repair exact omissions");
                if(scanCards)Check(prompt.Contains("第二行") && prompt.Contains("不得均分图片宽度"),"OCR text order cannot be used as draft layout");
            }
            Call("ValidateCoordinateContract",pixelCard.Replace("800,","800.0,"),new Size(800,400));checks++;
            Reject(()=>Call("ValidateCoordinateContract",pixelCard.Replace("\"imageWidth\":800","\"imageWidth\":true"),new Size(800,400)),"non-numeric image sizes rejected");
            Reject(()=>Call("ValidateCoordinateContract",pixelCard.Replace("\"imageHeight\":400,",""),new Size(800,400)),"missing image dimensions cannot silently use defaults");
            Check(((Point)Call("TranslatePoint", new Point(400,300), new[] { 100,100,1200,800,144 }, new[] { -200,150,1200,800,144 })) == new Point(100,350), "window movement translated once including negative desktop origin");
            Reject(() => Call("TranslatePoint", Point.Empty, new[] {0,0,1200,800,96}, new[] {0,0,1600,900,96}), "resized draft grid rejected");
            Reject(() => Call("TranslatePoint", Point.Empty, new[] {0,0,1200,800,96}, new[] {0,0,1200,800,144}), "changed monitor DPI rejected");
            using(var templateImage = new Bitmap(81,25)) using(var scene = new Bitmap(105,49)) using(var tg = Graphics.FromImage(templateImage)) using(var sg = Graphics.FromImage(scene)) {
                tg.Clear(Color.FromArgb(25,25,25)); tg.DrawLine(Pens.White,31,5,49,19); tg.DrawLine(Pens.White,31,19,49,5);
                sg.Clear(Color.FromArgb(25,25,25)); sg.DrawImageUnscaled(templateImage,18,8);
                var match = (Point?)Call("MatchButton",templateImage,scene);
                Check(match.HasValue && match.Value == new Point(58,20), "recorded dark button matches with a local position correction");
                Check((bool)Call("LegacyButtonReady","wait_close",templateImage), "legacy dark close button recognized even when center pixel is dark");
                sg.Clear(Color.White);
                Check(Call("MatchButton",templateImage,scene)==null && !(bool)Call("LegacyButtonReady","wait_close",scene), "unrelated solid bright panel cannot mark export complete");
                sg.Clear(Color.FromArgb(30,210,210));
                Check((bool)Call("LegacyButtonReady","return_home",scene) && !(bool)Call("LegacyButtonReady","wait_close",scene), "return-home button does not count as completed export close button");
                tg.Clear(Color.Black); sg.Clear(Color.Black);
                Check(Call("MatchButton",templateImage,scene)==null, "featureless background never matches a recorded button");
            }
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
            DraftHomeChecks();
            UseFakeRecording();
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
            string[] recordingSteps = { "export", "confirm", "close_btn", "draft_close" };
            for (int i=0;i<recordingSteps.Length;i++) {
                var state=(IDictionary)engine.Snapshot()["recordingProgress"];
                Check(Field("_recState").Equals(recordingSteps[i]) && state["step"].Equals(recordingSteps[i]), "F8 advances directly to the correct coordinate");
                Check(state["current"].Equals(i+1) && state["completed"].Equals(i) && state["total"].Equals(4), "four-step card counts remain consistent");
                Check(state["skipAvailable"].Equals(false) && !Convert.ToString(state["message"]).Contains("F9"), "recording never requires F9");
                if(i==2) {
                    Record(false,true);
                    Check(Field("_recState").Equals("close_btn") && ((IDictionary)engine.Snapshot()["recordingProgress"])["completed"].Equals(2), "failed close-button capture retries without consuming a step");
                }
                if(i==3) {
                    Set("_readCursor", new Func<Point>(() => new Point(500,350)));
                    Record(false,false);
                    Check(Field("_recState").Equals("draft_close") && Convert.ToString(engine.Snapshot()["recordingError"]).Contains("坐标相同"), "duplicate last step stays retryable rather than saving a broken template");
                    UseFakeRecording();
                }
                Record(false, false);
            }
            Check(((IDictionary)engine.Snapshot()["recordingProgress"])["completed"].Equals(4), "four-step recording completes");
            Check(!(bool)engine.Snapshot()["recording"] && (bool)engine.Snapshot()["coordinatesReady"], "four F8 captures save a usable template");
            var recorded=(Dictionary<string,int[]>)Field("_coords");
            Check(recorded["popup_close"]==null && recordingSteps.All(step=>recorded[step]!=null), "wait-close template records only its four required buttons");
            Check(((Dictionary<string,string>)Field("_buttonImages")).ContainsKey("close_btn") && ((Dictionary<string,string>)Field("_buttonImages")).ContainsKey("draft_close"), "four-F8 recording captures both closing buttons without an F9 step");
            Reject(() => Call("ValidateRecordedStep", "draft_close", new Point(recorded["close_btn"][0],recorded["close_btn"][1]), recorded), "duplicate closing coordinates rejected before save or export");
            string savedPath=Convert.ToString(Field("_activeTemplatePath")),savedBytes=File.ReadAllText(savedPath);
            Check((bool)Call("LoadCoordinateTemplate",savedPath) && (bool)Call("ModeCoordsReady","wait_close"), "four-step template reloads with the existing schema");
            Check(((Dictionary<string,string>)Field("_buttonImages")).Count==2 && ((Dictionary<string,int[]>)Field("_coordinateFrames")).Count==4,"button images and window anchors survive reload");
            Call("LoadAutomationTemplate", Args());
            Check(((Dictionary<string,string>)Field("_buttonImages")).Count==0 && ((Dictionary<string,int[]>)Field("_coordinateFrames")).Count==0,"legacy template clears stale visual data");
            Call("LoadCoordinateTemplate", savedPath);
            engine.Dispatch("wizard",Args()); Record(false,false); Record(false,false); Record(false,false); Call("OnKeyF10");
            Check(File.ReadAllText(savedPath)==savedBytes && Convert.ToString(Field("_activeTemplatePath"))==savedPath, "cancelling before fourth F8 preserves the previous template");
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
            Check(JianYingDraftIO.OrderLibraries(libs, "").SequenceEqual(new[] { libs[1], libs[0] }), "verified compatible 11.6.5 interface is tried before restricted 11.7.5 interface");
            Check(JianYingDraftIO.CompatibilityRoot(Path.Combine(root,"XM","resources","jianying"),null)==Path.Combine(root,"XM","data","draft-compat"),"portable compatibility runtime found without launcher environment");
            Check(JianYingDraftIO.CompatibilityRoot(root,Path.Combine(root,"custom-profile"))==Path.Combine(root,"custom-profile","draft-compat"),"explicit independent profile retains own compatibility directory");
            string runtime = Path.Combine(root,"runtime"); Directory.CreateDirectory(runtime);
            string dll = Path.Combine(runtime,"videoeditor.dll"); File.WriteAllText(dll,"fixture");
            string fixtureHash; using(var sha=System.Security.Cryptography.SHA256.Create()) fixtureHash=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(dll))).Replace("-","").ToLowerInvariant();
            var runtimeFiles=Args("videoeditor.dll",Args("sha256",fixtureHash,"size",new FileInfo(dll).Length));
            File.WriteAllText(Path.Combine(runtime,"runtime.json"),json.Serialize(Args("files",runtimeFiles)));
            JianYingDraftIO.VerifyCompatibilityRuntime(dll,()=>{}); checks++;
            File.WriteAllText(dll,"changed"); File.SetLastWriteTimeUtc(dll,DateTime.UtcNow.AddSeconds(1));
            Reject(()=>JianYingDraftIO.VerifyCompatibilityRuntime(dll,()=>{}),"changed runtime rejected even after a previous verification");
            runtimeFiles["missing.dll"]=Args("sha256",fixtureHash,"size",7);
            File.WriteAllText(Path.Combine(runtime,"runtime.json"),json.Serialize(Args("files",runtimeFiles)));
            Reject(()=>JianYingDraftIO.VerifyCompatibilityRuntime(dll,()=>{}),"copying only the main DLL cannot masquerade as a complete compatibility runtime");
            runtimeFiles.Remove("missing.dll");runtimeFiles["../escape.dll"]=Args("sha256",fixtureHash,"size",7);
            File.WriteAllText(Path.Combine(runtime,"runtime.json"),json.Serialize(Args("files",runtimeFiles)));
            Reject(()=>JianYingDraftIO.VerifyCompatibilityRuntime(dll,()=>{}),"runtime manifest cannot traverse outside its directory");
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
            string failureMessage="";
            try { JianYingDraftIO.RequestWithLibraries("read",first,null,()=>{},new[] {libs[0]},(mode,file,input,cancel,lib)=>{throw new InvalidOperationException("错误 6");},null); }
            catch(InvalidOperationException ex){ failureMessage=ex.Message; }
            Check(failureMessage.Contains("未检测到 11.6.5") && failureMessage.Contains("无需回退"),"11.7.5-only machines receive a missing-component repair instruction");
            output.WriteLine("Native compatibility checks passed: " + checks);
            return 0;
        } catch (Exception ex) { output.WriteLine(ex.ToString()); return 1; }
        finally { if (engine != null) engine.Close(); Console.SetOut(output); foreach (var file in Directory.GetFiles(root, "*", SearchOption.AllDirectories)) File.SetAttributes(file, FileAttributes.Normal); Directory.Delete(root, true); }
    }
}
