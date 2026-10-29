using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Collections.Generic;

// Patches only the isolated copy of an old Electron executable so it can run
// the bundled, local-only storage exporter. The installed executable is untouched.
internal static class MigrationHelper {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryEx(string file, IntPtr handle, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr FindResource(IntPtr module, string name, string type);
    [DllImport("kernel32.dll")] static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll")] static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll")] static extern IntPtr LockResource(IntPtr resource);
    [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResource(string file, bool delete);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool UpdateResource(IntPtr update, string type, string name, ushort language, byte[] data, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr update, bool discard);
    static int Main(string[] args) {
        try {
            if (args.Length != 2 || !System.Text.RegularExpressions.Regex.IsMatch(args[1], "^[a-f0-9]{64}$")) throw new Exception("Invalid migration input");
            string exe = Path.GetFullPath(args[0]);
            IntPtr module = LoadLibraryEx(exe, IntPtr.Zero, 2 | 32);
            if (module == IntPtr.Zero) throw new Exception("Cannot read isolated runtime");
            byte[] bytes;
            try {
                IntPtr resource = FindResource(module, "ELECTRONASAR", "INTEGRITY");
                if (resource == IntPtr.Zero) return 0; // Older runtimes do not enable ASAR integrity.
                bytes = new byte[SizeofResource(module, resource)];
                Marshal.Copy(LockResource(LoadResource(module, resource)), bytes, 0, bytes.Length);
            } finally { FreeLibrary(module); }
            var json = new JavaScriptSerializer();
            var records = json.Deserialize<List<Dictionary<string, object>>>(Encoding.UTF8.GetString(bytes));
            if (records.Count != 1 || Convert.ToString(records[0]["file"]) != @"resources\app.asar" || Convert.ToString(records[0]["alg"]) != "SHA256") throw new Exception("Unsupported runtime integrity format");
            records[0]["value"] = args[1]; bytes = Encoding.UTF8.GetBytes(json.Serialize(records));
            IntPtr update = BeginUpdateResource(exe, false); if (update == IntPtr.Zero) throw new Exception("Cannot prepare isolated runtime");
            bool saved = UpdateResource(update, "INTEGRITY", "ELECTRONASAR", 1033, bytes, (uint)bytes.Length);
            if (!EndUpdateResource(update, !saved) || !saved) throw new Exception("Cannot save isolated runtime");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
