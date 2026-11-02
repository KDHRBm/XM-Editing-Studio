using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Windows.Forms;
using XM.Native;

internal static class NativeShellIdentityTests {
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out ShellIdentity.IPropertyStore store);
    [DllImport("shell32.dll")] static extern int GetCurrentProcessExplicitAppUserModelID(out IntPtr value);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    static void CreateLink(string file, string target, string oldDirectory, string icon) {
        object shell = new ShellIdentity.ShellLinkObject();
        try {
            var link = (ShellIdentity.IShellLink)shell;
            link.SetPath(target); link.SetWorkingDirectory(oldDirectory); link.SetArguments("--kept \"带空格的参数 value\"");
            link.SetDescription("preserve description"); link.SetShowCmd(3); link.SetIconLocation(icon, 0);
            ((IPersistFile)shell).Save(file, true);
        } finally { Marshal.FinalReleaseComObject(shell); }
    }
    [STAThread] static int Main(string[] args) {
        string root = args[0], icon = args[1], target = Path.Combine(root, "安装目录", "小马剪辑台.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(target)); File.Copy(Application.ExecutablePath, target);
        string shortcut = Path.Combine(root, "XM剪辑台.lnk"), backups = Path.Combine(root, "backups");
        CreateLink(shortcut, target, Path.Combine(root, "obsolete-stage"), Application.ExecutablePath);
        byte[] original = File.ReadAllBytes(shortcut);
        Check(ShellIdentity.RepairShortcut(shortcut, target, icon, backups), "stale shortcut must be repaired");
        string[] saved = Directory.GetFiles(backups);
        Check(saved.Length == 1 && original.SequenceEqual(File.ReadAllBytes(saved[0])), "backup must contain exact original bytes");
        object shell = new ShellIdentity.ShellLinkObject();
        try {
            ((IPersistFile)shell).Load(shortcut, 0); var link = (ShellIdentity.IShellLink)shell;
            Check(ShellIdentity.Read((ShellIdentity.IPropertyStore)shell, 5) == ShellIdentity.AppId, "explicit AppID persists");
            var value = new StringBuilder(32768); link.GetPath(value, value.Capacity, IntPtr.Zero, 4);
            Check(value.ToString() == target, "target preserved");
            link.GetWorkingDirectory(value, value.Capacity); Check(value.ToString() == Path.GetDirectoryName(target), "working directory corrected");
            int index; link.GetIconLocation(value, value.Capacity, out index); Check(value.ToString() == icon && index == 0, "app icon set");
            link.GetArguments(value, value.Capacity); Check(value.ToString() == "--kept \"带空格的参数 value\"", "arguments preserved");
            link.GetDescription(value, value.Capacity); Check(value.ToString() == "preserve description", "description preserved");
            int show; link.GetShowCmd(out show); Check(show == 3, "show mode preserved");
        } finally { Marshal.FinalReleaseComObject(shell); }
        byte[] repaired = File.ReadAllBytes(shortcut);
        Check(!ShellIdentity.RepairShortcut(shortcut, target, icon, backups), "second run is no-op");
        Check(repaired.SequenceEqual(File.ReadAllBytes(shortcut)) && Directory.GetFiles(backups).Length == 1, "no rewrite or extra backup on second run");
        string other = Path.Combine(root, "Fork.lnk"); CreateLink(other, Path.Combine(root, "fork", "小马剪辑台.exe"), root, icon);
        byte[] foreign = File.ReadAllBytes(other);
        Check(!ShellIdentity.RepairShortcut(other, target, icon, backups), "another installation must not be changed");
        Check(foreign.SequenceEqual(File.ReadAllBytes(other)) && Directory.GetFiles(backups).Length == 1, "foreign shortcut remains byte-identical");
        ShellIdentity.SetProcess(); IntPtr appId;
        Marshal.ThrowExceptionForHR(GetCurrentProcessExplicitAppUserModelID(out appId));
        try { Check(Marshal.PtrToStringUni(appId) == ShellIdentity.AppId, "process ID matches launch link"); } finally { Marshal.FreeCoTaskMem(appId); }
        using (var window = new StudioWindow()) {
            window.ShowInTaskbar = false; window.Icon = new Icon(icon);
            ShellIdentity.SetWindow(window.Handle, target, icon);
            Guid iid = typeof(ShellIdentity.IPropertyStore).GUID; ShellIdentity.IPropertyStore store;
            Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window.Handle, ref iid, out store));
            try {
                Check(ShellIdentity.Read(store, 5) == ShellIdentity.AppId, "window ID matches process and launch link");
                Check(ShellIdentity.Read(store, 2) == "\"" + target + "\"", "relaunch path safely quoted");
                Check(ShellIdentity.Read(store, 3) == icon + ",0", "window relaunch icon matches link");
                Check(ShellIdentity.Read(store, 4) == "XM剪辑台", "display name set");
            } finally { Marshal.ReleaseComObject(store); }
            Check(SendMessage(window.Handle, 0x7F, new IntPtr(1), IntPtr.Zero) != IntPtr.Zero, "taskbar large icon present");
            Check(SendMessage(window.Handle, 0x7F, IntPtr.Zero, IntPtr.Zero) != IntPtr.Zero, "taskbar small icon present");
        }
        Console.WriteLine("PASS: process/window identity, window icons, shortcut repair, backup, idempotence and installation isolation.");
        return 0;
    }
}
