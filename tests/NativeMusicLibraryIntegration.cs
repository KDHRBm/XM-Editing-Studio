using System;
using System.IO;
using System.Linq;
using XM.Native;
namespace XM.Native {
    internal sealed partial class StudioHost {
        internal StudioHost(string testProfile) { DataDir = testProfile; }
        internal object TestConnect(string[] folders) { return ConnectMusicFolders(folders).GetAwaiter().GetResult(); }
        internal object TestAddFolders(params string[] folders) { return AddQuickFolders(folders).GetAwaiter().GetResult(); }
        internal object TestRemoveFolder(string id) { return QuickLaunch("removeFolder",id).GetAwaiter().GetResult(); }
    }
}
internal static class NativeMusicLibraryIntegration {
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    static void CheckFolders(string root,string profile) {
        string file=Path.Combine(profile,"quick-launch.json"),first=Path.Combine(root,"草稿 空格");Directory.CreateDirectory(first);
        J.Save(file,J.Obj("folders",new[]{J.Obj("id","existing","path",first,"name","自定义名称")},"selected","E:\\JianyingPro.exe","keep","fixture"));
        using(var host=new StudioHost(profile)) {
            string[] folders=Enumerable.Range(0,8).Select(n=>Path.Combine(root,"快捷目录"+n)).ToArray();
            foreach(string folder in folders)Directory.CreateDirectory(folder);
            var added=J.Arr(J.Get(host.TestAddFolders(first.ToUpperInvariant()+"\\",folders[0],folders[0]+"\\"),"folders"));
            Check(added.Length==2&&J.Str(added[0],"id")=="existing"&&J.Str(added[0],"name")=="自定义名称","Duplicates preserve existing ID and display name");
            Check(J.Str(J.Read(file,null),"selected")=="E:\\JianyingPro.exe"&&J.Str(J.Read(file,null),"keep")=="fixture","Other quick settings are preserved");
            string saved=File.ReadAllText(file),ordinary=Path.Combine(root,"not-a-folder.txt");File.WriteAllText(ordinary,"keep");
            foreach(string invalid in new[]{ordinary,Path.Combine(root,"missing"),"relative", "C:relative", "\\root-relative"}) {
                try {host.TestAddFolders(folders[1],invalid);throw new Exception("Invalid folder accepted");}catch(IOException){}
                Check(File.ReadAllText(file)==saved,"Invalid mixed drop must not partially persist");
            }
            Check(J.Arr(J.Get(host.TestAddFolders(folders[1]),"folders")).Length==3,"Failed drops must not mutate in-memory settings");
            added=J.Arr(J.Get(host.TestAddFolders(folders.Skip(2).Take(5).ToArray()),"folders"));Check(added.Length==8,"Eight shortcuts are supported");
            saved=File.ReadAllText(file);
            try{host.TestAddFolders(folders[7]);throw new Exception("Ninth shortcut accepted");}catch(IOException){}
            Check(saved==File.ReadAllText(file),"Overflow leaves saved data unchanged");
            Check(J.Arr(J.Get(host.TestAddFolders(first),"folders")).Length==8,"Repeat drop at capacity succeeds without duplication");
            host.TestRemoveFolder("existing");Check(Directory.Exists(first),"Removing shortcut must not delete folder");
        }
        using(var host=new StudioHost(profile))Check(J.Arr(J.Get(host.TestAddFolders(first),"folders")).Length==8,"Shortcuts survive host restart");
    }
    [STAThread] static int Main() {
        string root=Path.Combine(Path.GetTempPath(),"xm-library-"+Guid.NewGuid().ToString("N"));
        try {
            string music=Path.Combine(root,"中文 音乐库"), nested=Path.Combine(music,"剧情"), profile=Path.Combine(root,"profile");
            Directory.CreateDirectory(nested); Directory.CreateDirectory(profile);
            File.WriteAllText(Path.Combine(music,"紧张.mp3"),"fixture"); File.WriteAllText(Path.Combine(nested,"温暖.wav"),"fixture");
            File.WriteAllText(Path.Combine(music,"notes.txt"),"ignored");
            using(var host=new StudioHost(profile)) {
                var catalog=host.TestConnect(new[]{music,nested});
                Check(J.Arr(J.Get(catalog,"tracks")).Length==2,"Recursive music scanning deduplicates overlapping roots");
                catalog=host.TestConnect(new[]{music.ToUpperInvariant()+"\\"});
                Check(J.Arr(J.Get(catalog,"directories")).Length==2,"Repeat drop cannot add duplicate libraries");
                string saved=File.ReadAllText(Path.Combine(profile,"music-library.json"));
                try {host.TestConnect(new[]{music,Path.Combine(root,"missing")});throw new Exception("Missing folder was accepted");}catch(IOException){}
                Check(File.ReadAllText(Path.Combine(profile,"music-library.json"))==saved,"Invalid drop leaves persisted configuration unchanged");
                File.WriteAllText(Path.Combine(nested,"新音乐.flac"),"fixture");
                Check(J.Arr(J.Get(host.TestConnect(new[]{music}),"tracks")).Length==3,"Repeat drop rescans newly added music");
            }
            CheckFolders(root,profile);
            Console.WriteLine("Native music recursion and shortcut drop persistence passed"); return 0;
        } finally {if(Directory.Exists(root))Directory.Delete(root,true);}
    }
}
