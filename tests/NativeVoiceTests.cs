using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Windows.Forms;
namespace XM.Native {
    internal sealed partial class StudioHost {
        internal string BaseDir, DataDir;
        private Form MainWindow = null;
        private void Ui(Action fn) { fn(); }
        private void Emit(string name, object value) {}
        private string[] ChooseFiles(string filter) { return new string[0]; }
        private static void ValidatePathChain(string path) {}
        private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
        internal async Task Verify() {
            Check(!Directory.Exists(VoiceRoot), "Clean fixture");
            var status = VoiceStatus(); Check(!J.Bool(status,"modelReady") && !J.Bool(status,"runtimeReady"), "Fresh status is uninstalled");
            Check(!Directory.Exists(VoiceRoot), "Reading status creates no model/runtime data");
            bool failed=false; try { await VoiceAction("generate", J.Obj("text","test")); } catch { failed=true; }
            Check(failed && voiceGate.CurrentCount==1, "No inference before installation; gate released");
            failed=false; try { VoiceOutput("../../outside"); } catch { failed=true; } Check(failed,"Reject audio traversal");
            failed=false; try { await VoiceAction("unknown",null); } catch { failed=true; } Check(failed,"Unknown command rejected");
            Directory.CreateDirectory(Path.GetDirectoryName(VoicePython));
            File.Copy(Process.GetCurrentProcess().MainModule.FileName,VoicePython);
            J.Save(Path.Combine(VoiceRoot,"runtime-ready.json"),J.Obj("version","2.0.3"));
            var files=Enumerable.Range(0,5).Select(n=>J.Obj("Path","fixture"+n,"Size",1)).ToArray();
            foreach(var file in files){string p=J.Under(Path.Combine(VoiceRoot,"models","VoxCPM2"),J.Str(file,"Path"));Directory.CreateDirectory(Path.GetDirectoryName(p));File.WriteAllText(p,"x");}
            J.Save(Path.Combine(VoiceRoot,"model-ready.json"),J.Obj("model","OpenBMB/VoxCPM2","files",files));
            Check(VoiceModelReady && VoiceRuntimeReady,"Complete inventory ready");
            var task=VoiceAction("generate",J.Obj("text","test"));
            await Task.Delay(150); failed=false;try { await VoiceAction("generate",J.Obj("text","duplicate")); } catch { failed=true; }
            Check(failed,"Concurrent operation rejected");
            await task;
            Check(J.Str(voiceProgress,"stage")=="complete","Worker structured event received");
            Check(Directory.GetFiles(Path.Combine(VoiceRoot,"jobs")).Length==0,"Request cleaned after completion");
            task=VoiceAction("generate",J.Obj("slow",true)); await Task.Delay(250);
            await VoiceAction("cancel",null); await task;
            Check(J.Str(voiceProgress,"stage")=="cancelled" && voiceGate.CurrentCount==1,"Owned child stopped and gate recovered");
            Check(VoiceModelReady,"Cancellation preserves models");
            Check(Directory.GetFiles(Path.Combine(VoiceRoot,"jobs")).Length==0,"Request cleaned after cancellation");
            failed=false;try { await VoiceAction("generate",J.Obj("fail",true)); } catch(Exception error){failed=error.Message=="fixture error";}
            Check(failed,"Worker failure not reported as success");
            Check(VoiceModelReady,"Failure preserves models");
            File.Delete(Path.Combine(VoiceRoot,"models","VoxCPM2","fixture0"));
            Check(!VoiceModelReady,"Incomplete model not marked ready");
            Console.WriteLine("PASS 16 native voice checks");
        }
    }
    internal static class VoiceTests {
        [STAThread] static int Main(string[] args) {
            if(args.Contains("--action")) {
                int at=Array.IndexOf(args,"--request");var value=at>=0 ? J.Read(args[at+1],null):null;
                if(J.Bool(value,"slow"))Thread.Sleep(20000);else Thread.Sleep(450);
                if(J.Bool(value,"fail")){Console.WriteLine("@XMVOX@{\"stage\":\"error\",\"message\":\"fixture error\"}");return 1;}
                Console.WriteLine("@XMVOX@{\"stage\":\"complete\",\"message\":\"fixture complete\"}");return 0;
            }
            string root=Path.Combine(Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName),"fixture-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
            try {new StudioHost{BaseDir=root,DataDir=Path.Combine(root,"data")}.Verify().GetAwaiter().GetResult();return 0;}
            catch(Exception error){Console.Error.WriteLine(error);return 1;}
        }
    }
}
