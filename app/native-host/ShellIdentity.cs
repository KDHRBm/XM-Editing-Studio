using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace XM.Native {
    // The process, its window and launch links must share one identity, including
    // links pinned before the move from Electron to the native host.
    internal static class ShellIdentity {
        internal const string AppId = "com.xiaoma.editing-studio";
        private static readonly Guid AppProperties = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
        [StructLayout(LayoutKind.Sequential)] internal struct PropertyKey {
            internal Guid Format; internal uint Id;
            internal PropertyKey(uint id) { Format = AppProperties; Id = id; }
        }
        [StructLayout(LayoutKind.Explicit, Size = 24)] internal struct PropVariant {
            [FieldOffset(0)] internal ushort Type;
            [FieldOffset(8)] internal IntPtr Value;
        }
        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        internal interface IPropertyStore {
            void GetCount(out uint count);
            void GetAt(uint index, out PropertyKey key);
            void GetValue(ref PropertyKey key, out PropVariant value);
            void SetValue(ref PropertyKey key, ref PropVariant value);
            void Commit();
        }
        [ComImport, Guid("00021401-0000-0000-C000-000000000046")] internal class ShellLinkObject {}
        [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        internal interface IShellLink {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int length, IntPtr findData, uint flags);
            void GetIDList(out IntPtr idList); void SetIDList(IntPtr idList);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int length);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int length);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int length);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
            void GetHotkey(out short hotkey); void SetHotkey(short hotkey);
            void GetShowCmd(out int show); void SetShowCmd(int show);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int length, out int index);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
            void Resolve(IntPtr hwnd, uint flags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
        }
        [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern int SetCurrentProcessExplicitAppUserModelID(string id);
        [DllImport("shell32.dll")] private static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern void SHChangeNotify(uint eventId, uint flags, [MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr unused);
        internal static void SetProcess() { Marshal.ThrowExceptionForHR(SetCurrentProcessExplicitAppUserModelID(AppId)); }
        internal static string Read(IPropertyStore store, uint id) {
            var key = new PropertyKey(id); PropVariant value; store.GetValue(ref key, out value);
            try { return value.Type == 31 ? Marshal.PtrToStringUni(value.Value) : ""; }
            finally { PropVariantClear(ref value); }
        }
        private static void Write(IPropertyStore store, uint id, string text) {
            var key = new PropertyKey(id); var value = new PropVariant { Type = 31, Value = Marshal.StringToCoTaskMemUni(text) };
            try { store.SetValue(ref key, ref value); } finally { PropVariantClear(ref value); }
        }
        internal static void SetWindow(IntPtr hwnd, string exe, string icon) {
            Guid iid = typeof(IPropertyStore).GUID; IPropertyStore store;
            Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(hwnd, ref iid, out store));
            try {
                // Windows expects relaunch metadata before the explicit ID.
                Write(store, 2, "\"" + exe + "\""); Write(store, 3, icon + ",0");
                Write(store, 4, "XM剪辑台"); Write(store, 5, AppId); store.Commit();
            } finally { Marshal.ReleaseComObject(store); }
        }
        internal static bool RepairShortcut(string file, string exe, string icon, string backupRoot) {
            object shell = new ShellLinkObject();
            try {
                var persist = (IPersistFile)shell; persist.Load(file, 2); // STGM_READWRITE is required for the property store.
                var link = (IShellLink)shell; var target = new StringBuilder(32768); link.GetPath(target, target.Capacity, IntPtr.Zero, 4);
                // Never change another installation, the fork, or a helper link.
                if (target.Length == 0 || !string.Equals(Path.GetFullPath(Environment.ExpandEnvironmentVariables(target.ToString())), Path.GetFullPath(exe), StringComparison.OrdinalIgnoreCase)) return false;
                var directory = new StringBuilder(32768); link.GetWorkingDirectory(directory, directory.Capacity);
                var oldIcon = new StringBuilder(32768); int index; link.GetIconLocation(oldIcon, oldIcon.Capacity, out index);
                var store = (IPropertyStore)shell; string expectedDirectory = Path.GetDirectoryName(exe);
                if (Read(store, 5) == AppId && string.Equals(directory.ToString(), expectedDirectory, StringComparison.OrdinalIgnoreCase) && string.Equals(oldIcon.ToString(), icon, StringComparison.OrdinalIgnoreCase) && index == 0) return false;
                Directory.CreateDirectory(backupRoot);
                string backup = Path.Combine(backupRoot, Path.GetFileNameWithoutExtension(file) + "-" + Guid.NewGuid().ToString("N") + ".lnk");
                File.Copy(file, backup, false);
                try {
                    link.SetWorkingDirectory(expectedDirectory); link.SetIconLocation(icon, 0); Write(store, 5, AppId); store.Commit(); persist.Save(file, true);
                } catch { File.Copy(backup, file, true); throw; }
                SHChangeNotify(0x2000, 0x5, file, IntPtr.Zero);
                return true;
            } finally { Marshal.FinalReleaseComObject(shell); }
        }
        internal static void RepairLaunchers(string exe, string icon, string profile, Action<string> log) {
            string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string[] roots = { Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Environment.GetFolderPath(Environment.SpecialFolder.Programs), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "XM剪辑台"), Path.Combine(roaming, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar") };
            foreach (string root in roots) {
                if (!Directory.Exists(root)) continue;
                try { foreach (string link in Directory.GetFiles(root, "*.lnk", SearchOption.TopDirectoryOnly)) {
                    try { if (RepairShortcut(link, exe, icon, Path.Combine(profile, "shortcut-backups"))) log("shortcut-identity-repaired " + Path.GetFileName(link)); }
                    catch (Exception error) { log("shortcut-identity " + error.GetType().Name); }
                } } catch (Exception error) { log("shortcut-directory " + error.GetType().Name); }
            }
        }
    }
}
