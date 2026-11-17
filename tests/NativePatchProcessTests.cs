using System;
using System.IO;
using System.Diagnostics;
using System.Reflection;
using System.Threading;
using System.Collections;
using System.Windows.Forms;

internal static class NativePatchProcessTests {
    static int checks;
    static void Check(bool ok,string message) { if(!ok)throw new Exception(message);checks++; }
    static object Call(string name,params object[] args) {
        var method=typeof(NativePatchUpdater).GetMethod(name,BindingFlags.Static|BindingFlags.NonPublic|BindingFlags.Public);
        Check(method!=null,"Updater must provide "+name);
        try {return method.Invoke(null,args);}catch(TargetInvocationException e){System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(e.InnerException).Throw();throw;}
    }
    static void Reject(Action action,string text) {
        try {action();}catch(Exception e){Check(e.Message.Contains(text),"Expected rejection: "+text+"; got "+e.Message);return;}
        throw new Exception("Expected rejection: "+text);
    }
    static Process Start(string root,string name) {
        string exe=Path.Combine(root,name);Directory.CreateDirectory(Path.GetDirectoryName(exe));
        File.Copy(Assembly.GetExecutingAssembly().Location,exe);
        string ready=exe+".ready";
        var p=Process.Start(new ProcessStartInfo(exe,"--idle \""+ready+"\""){UseShellExecute=false,CreateNoWindow=true});
        var clock=Stopwatch.StartNew();while(!File.Exists(ready)&&clock.ElapsedMilliseconds<5000)Thread.Sleep(25);
        Check(File.Exists(ready),"Fixture process ready");return p;
    }
    static bool Alive(Process p){p.Refresh();return !p.HasExited;}
    [STAThread] static int Main(string[] args) {
        if(args[0]=="--idle"){File.WriteAllText(args[1],"ready");Thread.Sleep(30000);return 0;}
        Console.OutputEncoding=new System.Text.UTF8Encoding(false);
        string root=Path.GetFullPath(args[0]),target=Path.Combine(root,"安装目录"),other=target+"-other",invalid=Path.Combine(root,"invalid");
        Directory.CreateDirectory(target);Directory.CreateDirectory(invalid);
        File.WriteAllText(Path.Combine(target,"xiaoma-install.id"),"patch-process-fixture");
        Process app=null,model=null,pet=null,unrelated=null;
        try {
            app=Start(target,"小马剪辑台.exe");model=Start(target,"data/local-ai/runtime/ollama.exe");pet=Start(target,"resources/companion/pet.exe");unrelated=Start(other,"ollama.exe");
            Reject(()=>Call("Closed",target),"ollama.exe");
            var found=(IList)Call("RelatedProcesses",target);
            Check(found.Count==3,"Find app, pet and orphan model service; exclude sibling installation and updater");
            Reject(()=>Call("StopRelatedProcesses",invalid),"安装标记");Check(Alive(app)&&Alive(model)&&Alive(pet)&&Alive(unrelated),"Invalid directory cannot stop anything");
            File.WriteAllText(Path.Combine(root,"xiaoma-install.id"),"patch-process-fixture");
            Reject(()=>Call("StopRelatedProcesses",root),"安装目录之外");
            var message=(string)Call("StopRelatedProcesses",target);
            Check(!Alive(app)&&!Alive(model)&&!Alive(pet),"Stop all selected installation processes");
            Check(Alive(unrelated),"Same-name Ollama outside installation remains running");
            Call("Closed",target);
            Check(message.Contains("3"),"Report stopped count");
            Check(((string)Call("StopRelatedProcesses",target)).Contains("没有"),"Repeated stop is harmless");
            Check(File.ReadAllText(Path.Combine(target,"xiaoma-install.id"))=="patch-process-fixture","Stopping does not edit install files");
            using(var form=(Form)Call("CreateUpdaterForm",new object[]{new string[]{"--directory",target}})) {
                var buttons=form.Controls.Find("stopRelated",true);
                Check(buttons.Length==1&&buttons[0].Text=="停止相关程序"&&buttons[0].Enabled,"Updater exposes usable stop button");
            }
            Console.WriteLine("PASS "+checks+" updater process checks");return 0;
        } catch(Exception e){Console.Error.WriteLine(e);return 1;}
        finally {foreach(var p in new[]{app,model,pet,unrelated})if(p!=null){try{if(Alive(p)){p.Kill();p.WaitForExit(3000);}}catch{}p.Dispose();}}
    }
}
