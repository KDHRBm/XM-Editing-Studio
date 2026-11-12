using System;
using System.IO;
using System.Linq;
using XM.Native;
internal static class NativeDataDropTests {
    static void Check(bool value, string detail) { if (!value) throw new Exception(detail); }
    static int Main() {
        string root=Path.Combine(Path.GetTempPath(), "xm-data-drop-"+Guid.NewGuid().ToString("N"));
        string oldTemp=Environment.GetEnvironmentVariable("TEMP"), oldTmp=Environment.GetEnvironmentVariable("TMP");
        try {
            Directory.CreateDirectory(root); string nested=Path.Combine(root,"中文 子目录"); Directory.CreateDirectory(nested);
            File.WriteAllText(Path.Combine(root,"第1集.mp4"),"video"); File.WriteAllText(Path.Combine(nested,"第2集.srt"),"subtitle");
            File.WriteAllText(Path.Combine(nested,"第1集样片.mp4"),"previous output"); File.WriteAllText(Path.Combine(nested,"ignore.exe"),"ignored");
            var files=DropFiles.Expand(new[]{root,Path.Combine(root,"第1集.mp4")});
            Check(files.Length==2,"recursive supported files are deduplicated; rendered samples and executables excluded");
            string from=Path.Combine(root,"legacy"),to=Path.Combine(root,"portable");Directory.CreateDirectory(Path.Combine(from,"native-webview","main","Cache"));
            File.WriteAllText(Path.Combine(from,"settings.json"),"saved");File.WriteAllText(Path.Combine(from,"native-webview","main","Cache","cache"),"skip");
            DataPaths.CopyProfile(from,to);Check(File.ReadAllText(Path.Combine(to,"settings.json"))=="saved","settings copied");
            Check(!Directory.Exists(Path.Combine(to,"native-webview","main","Cache")),"rebuildable cache excluded");
            Check(File.Exists(Path.Combine(from,"settings.json")),"old profile unchanged");
            Check(DataPaths.Resolve(root,to)==to,"explicit isolated profile preserved");
            Check(Environment.GetEnvironmentVariable("TEMP")==Path.Combine(to,"cache","temp"),"child temporary files stay inside profile");
            string roaming=Path.Combine(root,"roaming"),electron=Path.Combine(roaming,"xiaoma-editing-studio");
            Directory.CreateDirectory(Path.Combine(electron,"Local Storage"));
            File.WriteAllText(Path.Combine(electron,"Local Storage","old-data"),"preserve old Electron data");
            string clean=Path.Combine(root,"fresh-install");Directory.CreateDirectory(clean);
            Check(DataPaths.Resolve(clean,null,roaming)==Path.Combine(clean,"data"),"fresh install starts despite old Electron profile");
            Check(DataPaths.LegacyProfilePending==electron,"legacy profile is reported on first launch");
            Check(File.ReadAllText(Path.Combine(clean,"data","legacy-profile-pending.txt"))==electron,"migration marker identifies old profile");
            Check(File.ReadAllText(Path.Combine(electron,"Local Storage","old-data"))=="preserve old Electron data","old data remains untouched");
            DataPaths.Resolve(clean,null,roaming);
            Check(DataPaths.LegacyProfilePending==null,"notice is shown once for a new install");
            string native=Path.Combine(roaming,"黑曜信号台");Directory.CreateDirectory(Path.Combine(native,"native-webview"));
            File.WriteAllText(Path.Combine(native,"settings.json"),"native profile");
            string second=Path.Combine(root,"second-install");Directory.CreateDirectory(second);
            DataPaths.Resolve(second,null,roaming);
            Check(File.ReadAllText(Path.Combine(second,"data","settings.json"))=="native profile","native profile takes priority over Electron data");
            Check(DataPaths.LegacyProfilePending==null,"native migration does not show old Electron warning");
            Console.WriteLine("Native data relocation and recursive pet drop passed");return 0;
        } finally {
            Environment.SetEnvironmentVariable("TEMP",oldTemp);Environment.SetEnvironmentVariable("TMP",oldTmp);Directory.Delete(root,true);
        }
    }
}
