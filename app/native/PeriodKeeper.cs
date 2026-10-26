// Adapted from Kirota233/JianYing-Period-Keeper, commit c6552bcfe86573be72e442aa9af292ad1047972b.
// Only the punctuation tables in JianyingPro's VECreator module are eligible.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class PeriodKeeper {
    [StructLayout(LayoutKind.Sequential)] struct MemoryRegion {
        public IntPtr BaseAddress, AllocationBase;
        public uint AllocationProtect;
        public ushort PartitionId;
        public UIntPtr RegionSize;
        public uint State, Protect, Type;
    }
    [DllImport("kernel32", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr read);
    [DllImport("kernel32", SetLastError=true)] static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr written);
    [DllImport("kernel32", SetLastError=true)] static extern bool VirtualProtectEx(IntPtr process, IntPtr address, UIntPtr size, uint protection, out uint old);
    [DllImport("kernel32")] static extern UIntPtr VirtualQueryEx(IntPtr process, IntPtr address, out MemoryRegion region, UIntPtr length);
    [DllImport("kernel32")] static extern bool FlushInstructionCache(IntPtr process, IntPtr address, UIntPtr size);

    static readonly byte[][] Original = {
        Encoding.Unicode.GetBytes("。！？!?；;，,、.\n\r"),
        Encoding.UTF8.GetBytes("[。？！；“ .!?～]\0")
    };
    static readonly byte[][] Replacement = {
        Encoding.Unicode.GetBytes("！！？!?；;！!、!\n\r"),
        Encoding.UTF8.GetBytes("[？！；“ !?～]\0\0\0\0\0")
    };
    sealed class Patch {
        public int Pid, Pattern;
        public long Started, Address;
    }
    static readonly List<Patch> Patches = new List<Patch>();
    static readonly object Gate = new object();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static bool Enabled;
    static int ParentPid;
    static string LastError = "";
    static Dictionary<string, object> LastState = new Dictionary<string, object>();

    static bool BytesEqual(byte[] a, byte[] b) { return a.SequenceEqual(b); }
    static bool Read(IntPtr process, long address, int length, out byte[] bytes) {
        bytes = new byte[length]; UIntPtr read;
        return ReadProcessMemory(process, new IntPtr(address), bytes, (UIntPtr)length, out read) && read.ToUInt64() == (ulong)length;
    }
    static bool Replace(IntPtr process, long address, byte[] before, byte[] after) {
        byte[] existing;
        if (before.Length != after.Length || !Read(process, address, before.Length, out existing) || !BytesEqual(existing, before)) return false;
        uint protection; UIntPtr written;
        if (!VirtualProtectEx(process, new IntPtr(address), (UIntPtr)before.Length, 0x40, out protection)) return false;
        bool ok = false;
        try {
            ok = WriteProcessMemory(process, new IntPtr(address), after, (UIntPtr)after.Length, out written) && written.ToUInt64() == (ulong)after.Length;
            byte[] check;
            ok = ok && Read(process, address, after.Length, out check) && BytesEqual(check, after);
            if (!ok) WriteProcessMemory(process, new IntPtr(address), before, (UIntPtr)before.Length, out written);
        } finally {
            uint ignored;
            if (!VirtualProtectEx(process, new IntPtr(address), (UIntPtr)before.Length, protection, out ignored)) {
                LastError = "无法恢复剪映内存页属性，请关闭并重新打开剪映。";
            }
            FlushInstructionCache(process, new IntPtr(address), (UIntPtr)before.Length);
        }
        return ok;
    }
    static IEnumerable<int> Matches(byte[] data, byte[] pattern) {
        for (int i = 0; i <= data.Length - pattern.Length; i++) {
            if (data[i] != pattern[0]) continue;
            int j = 1; while (j < pattern.Length && data[i+j] == pattern[j]) j++;
            if (j == pattern.Length) { yield return i; i += pattern.Length - 1; }
        }
    }
    static int Scan(IntPtr process, long moduleStart, int moduleSize, int pid, long started, bool apply) {
        long end = checked(moduleStart + moduleSize), cursor = moduleStart;
        int matches = 0;
        while (cursor < end) {
            MemoryRegion region;
            if (VirtualQueryEx(process, new IntPtr(cursor), out region, (UIntPtr)Marshal.SizeOf(typeof(MemoryRegion))).ToUInt64() == 0) break;
            long next = Math.Min(end, checked(region.BaseAddress.ToInt64() + (long)region.RegionSize.ToUInt64()));
            if (next <= cursor) break;
            if (region.State == 0x1000 && (region.Protect & 0x100) == 0 && (region.Protect & 0xEE) != 0) {
                for (long chunk = cursor; chunk < next; chunk += 1024*1024) {
                    int length = (int)Math.Min(1024*1024 + 64, next-chunk);
                    byte[] data; if (!Read(process, chunk, length, out data)) continue;
                    for (int pattern = 0; pattern < Original.Length; pattern++) {
                        foreach (int offset in Matches(data, Original[pattern])) {
                            long address = chunk + offset;
                            if (offset >= 1024*1024) continue;
                            matches++;
                            if (apply && !Patches.Any(p => p.Pid == pid && p.Started == started && p.Address == address)) {
                                if (Replace(process, address, Original[pattern], Replacement[pattern])) Patches.Add(new Patch { Pid=pid, Started=started, Address=address, Pattern=pattern });
                                else LastError = "部分标点规则无法修改，请检查剪映与小马剪辑台是否使用相同的权限运行。";
                            }
                        }
                    }
                }
            }
            cursor = next;
        }
        return matches;
    }
    static bool IsSameProcess(Patch patch, out Process process) {
        process = null;
        try { process = Process.GetProcessById(patch.Pid); return !process.HasExited && process.StartTime.ToUniversalTime().Ticks == patch.Started && process.ProcessName.Equals("JianyingPro", StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }
    static void Restore() {
        Enabled = false;
        foreach (Patch patch in Patches.ToArray()) {
            Process process;
            if (!IsSameProcess(patch, out process)) { if (process != null) process.Dispose(); Patches.Remove(patch); continue; }
            using (process) {
                IntPtr handle = OpenProcess(0x438, false, patch.Pid);
                if (handle == IntPtr.Zero) { LastError = "尚有规则未恢复，请关闭剪映以恢复默认。"; continue; }
                try {
                    byte[] current;
                    if (!Read(handle, patch.Address, Replacement[patch.Pattern].Length, out current) || !BytesEqual(current, Replacement[patch.Pattern])) { Patches.Remove(patch); continue; }
                    if (Replace(handle, patch.Address, Replacement[patch.Pattern], Original[patch.Pattern])) Patches.Remove(patch);
                    else LastError = "尚有规则未恢复，请关闭剪映以恢复默认。";
                } finally { CloseHandle(handle); }
            }
        }
    }
    static Dictionary<string, object> Refresh(bool probe) {
        int processes=0, editors=0, denied=0, matches=0;
        var versions = new List<string>();
        foreach (Process process in Process.GetProcessesByName("JianyingPro")) {
            using (process) {
                processes++;
                try {
                    long started = process.StartTime.ToUniversalTime().Ticks;
                    foreach (ProcessModule module in process.Modules) {
                        if (!module.ModuleName.Equals("VECreator.dll", StringComparison.OrdinalIgnoreCase)) continue;
                        editors++;
                        string version = module.FileVersionInfo.FileVersion;
                        if (!String.IsNullOrEmpty(version) && !versions.Contains(version)) versions.Add(version);
                        // A loaded module with owned, still-active patches does not need another full scan.
                        var owned = Patches.Where(p=>p.Pid==process.Id && p.Started==started).ToArray();
                        IntPtr handle = OpenProcess(Enabled ? 0x438u : 0x410u, false, process.Id);
                        if (handle == IntPtr.Zero) { denied++; break; }
                        try {
                            foreach (var patch in owned) {
                                byte[] bytes;
                                if (!Read(handle, patch.Address, Replacement[patch.Pattern].Length, out bytes) || !BytesEqual(bytes, Replacement[patch.Pattern])) Patches.Remove(patch);
                            }
                            if ((Enabled || probe) && !Patches.Any(p=>p.Pid==process.Id && p.Started==started)) matches += Scan(handle,module.BaseAddress.ToInt64(),module.ModuleMemorySize,process.Id,started,Enabled);
                        } finally { CloseHandle(handle); }
                        break;
                    }
                } catch { denied++; }
            }
        }
        foreach (var patch in Patches.ToArray()) { Process process; bool same=IsSameProcess(patch,out process); if(process!=null)process.Dispose(); if(!same)Patches.Remove(patch); }
        string state = processes==0 ? "offline" : editors==0 ? (denied>0 ? "denied" : "standby") : denied>0 ? "denied" : Patches.Count>0 ? "active" : (Enabled || probe) && matches==0 ? "unsupported" : "ready";
        LastState = new Dictionary<string,object> { {"enabled",Enabled}, {"engine",state}, {"processes",processes}, {"editors",editors}, {"patchedSites",Patches.Count}, {"compatibleSites",matches}, {"versions",versions}, {"error",LastError} };
        return LastState;
    }
    static bool ParentAlive() { if(ParentPid==0)return true; try { using(var p=Process.GetProcessById(ParentPid))return !p.HasExited; } catch {return false;} }
    static int SelfTest() {
        for(int n=0;n<Original.Length;n++) if(Original[n].Length!=Replacement[n].Length)throw new Exception("Pattern length mismatch");
        IntPtr memory=Marshal.AllocHGlobal(4096), handle=OpenProcess(0x438,false,Process.GetCurrentProcess().Id);
        try {
            for(int n=0;n<Original.Length;n++) {
                Marshal.Copy(Original[n],0,memory,Original[n].Length);
                if(!Replace(handle,memory.ToInt64(),Original[n],Replacement[n]))throw new Exception("Patch failed");
                if(Replace(handle,memory.ToInt64(),Original[n],Replacement[n]))throw new Exception("Precondition ignored");
                if(!Replace(handle,memory.ToInt64(),Replacement[n],Original[n]))throw new Exception("Restore failed");
            }
            Console.WriteLine("{\"selfTest\":true,\"patterns\":2,\"patchAndRestore\":true,\"mismatchRejected\":true}"); return 0;
        } finally { CloseHandle(handle); Marshal.FreeHGlobal(memory); }
    }
    static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        if(args.Length==1 && args[0]=="--self-test")return SelfTest();
        if(args.Length!=2 || args[0]!="--parent-pid" || !Int32.TryParse(args[1],out ParentPid) || ParentPid<=0)return 2;
        bool acquired;
        using(var mutex=new Mutex(true,"Local\\Xiaoma.Jianying.PeriodKeeper",out acquired)) {
            if(!acquired) { Console.WriteLine("{\"error\":\"标点工具已在其他小马剪辑台窗口运行。\"}"); return 3; }
            Timer timer=null;
            try {
                timer=new Timer(delegate {
                    lock(Gate) {
                        try { if(!ParentAlive()){Restore();Environment.Exit(0);} if(Enabled)Refresh(false); }
                        catch { LastError="剪映状态读取失败，请关闭开关后重试。"; }
                    }
                },null,2000,4000);
                string line;
                while((line=Console.ReadLine())!=null) {
                    lock(Gate) {
                        object id=null;
                        try {
                            if(line.Length>256)throw new Exception("Invalid request");
                            var request=Json.Deserialize<Dictionary<string,object>>(line); id=request["id"];
                            string command=Convert.ToString(request["command"]);
                            if(command=="enable"){LastError="";Enabled=true;}
                            else if(command=="disable" || command=="shutdown"){LastError="";Restore();}
                            else if(command!="status" && command!="probe")throw new Exception("Unknown command");
                            var state=Refresh(command=="probe");
                            Console.WriteLine(Json.Serialize(new {id=id,state=state}));
                            if(command=="shutdown")return 0;
                        } catch(Exception error) { Console.WriteLine(Json.Serialize(new {id=id,error=error.Message})); }
                    }
                }
            } finally { if(timer!=null)timer.Dispose(); lock(Gate){Restore();} mutex.ReleaseMutex(); }
        }
        return 0;
    }
}
