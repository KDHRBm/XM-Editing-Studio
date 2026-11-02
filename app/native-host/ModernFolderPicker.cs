using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace XM.Native {
    internal static class ModernFolderPicker
    {
        [ComImport]
        [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
        public class FileOpenDialogRCW { }

        [ComImport]
        [Guid("d57c7288-d4ad-4768-be02-9d969532d960")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IFileOpenDialog
        {
            [PreserveSig] int Show([In] IntPtr parent);
            void SetFileTypes([In] uint cFileTypes, [In] IntPtr rgFilterSpec);
            void SetFileTypeIndex([In] uint iFileType);
            void GetFileTypeIndex(out uint piFileType);
            void Advise([In, MarshalAs(UnmanagedType.Interface)] IntPtr pfde, out uint pdwCookie);
            void Unadvise([In] uint dwCookie);
            void SetOptions([In] uint fos);
            void GetOptions(out uint pfos);
            void SetDefaultFolder([In, MarshalAs(UnmanagedType.Interface)] IShellItem psi);
            void SetFolder([In, MarshalAs(UnmanagedType.Interface)] IShellItem psi);
            void GetFolder([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
            void GetCurrentSelection([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
            void SetFileName([In, MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
            void SetTitle([In, MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
            void SetOkButtonLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszText);
            void SetFileNameLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
            void GetResult([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
            void AddPlace([In, MarshalAs(UnmanagedType.Interface)] IShellItem psi, int fdap);
            void SetDefaultExtension([In, MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
            void Close([MarshalAs(UnmanagedType.Error)] int hr);
            void SetClientGuid([In] ref Guid guid);
            void ClearClientData();
            void SetFilter([MarshalAs(UnmanagedType.Interface)] IntPtr pFilter);
            void GetResults([MarshalAs(UnmanagedType.Interface)] out IntPtr ppenum);
            void GetSelectedItems([MarshalAs(UnmanagedType.Interface)] out IntPtr ppsai);
        }

        [ComImport]
        [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IShellItem
        {
            void BindToHandler([In, MarshalAs(UnmanagedType.Interface)] IntPtr pbc, [In] ref Guid bhid, [In] ref Guid riid, out IntPtr ppv);
            void GetParent([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
            void GetDisplayName([In] uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
            void GetAttributes([In] uint sfgaoMask, out uint psfgaoAttribs);
            void Compare([In, MarshalAs(UnmanagedType.Interface)] IShellItem psi, [In] uint hint, out int piOrder);
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern int SHCreateItemFromParsingName(
            [In, MarshalAs(UnmanagedType.LPWStr)] string pszPath,
            [In] IntPtr pbc,
            [In] ref Guid riid,
            [Out] out IntPtr ppv);

        private const uint FOS_PICKFOLDERS = 0x00000020;
        private const uint FOS_FORCEFILESYSTEM = 0x00000040;
        private const uint SIGDN_FILESYSPATH = 0x80058000;

        public static string ShowDialog(IntPtr parentHwnd, string title, string initialFolder = null)
        {
            object instance = null;
            try {
                instance = new FileOpenDialogRCW(); var dialog = (IFileOpenDialog)instance;
                uint options; dialog.GetOptions(out options);
                dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | 0x800 | 0x02000000); // existing path, no recent-list pollution
                dialog.SetTitle(title);
                if (!string.IsNullOrEmpty(initialFolder) && Directory.Exists(initialFolder)) {
                    Guid iid = typeof(IShellItem).GUID; IntPtr pointer;
                    if (SHCreateItemFromParsingName(initialFolder, IntPtr.Zero, ref iid, out pointer) == 0 && pointer != IntPtr.Zero) {
                        IShellItem item = null;
                        try { item = (IShellItem)Marshal.GetObjectForIUnknown(pointer); dialog.SetFolder(item); }
                        finally { if (item != null) Marshal.ReleaseComObject(item); Marshal.Release(pointer); }
                    }
                }
                int hr = dialog.Show(parentHwnd);
                if (hr == unchecked((int)0x800704C7)) return ""; // cancellation is not an error
                Marshal.ThrowExceptionForHR(hr);
                IShellItem selected; dialog.GetResult(out selected);
                try { string path; selected.GetDisplayName(SIGDN_FILESYSPATH, out path); return path ?? ""; }
                finally { if (selected != null) Marshal.ReleaseComObject(selected); }
            } catch (COMException) { return Legacy(parentHwnd, title, initialFolder); }
            finally { if (instance != null) Marshal.FinalReleaseComObject(instance); }
        }
        private static string Legacy(IntPtr hwnd, string title, string initialFolder) {
            using (var dialog = new FolderBrowserDialog { Description = title, ShowNewFolderButton = true, SelectedPath = initialFolder ?? "" })
                return dialog.ShowDialog(new Owner(hwnd)) == DialogResult.OK ? dialog.SelectedPath : "";
        }
        private sealed class Owner : IWin32Window {
            private readonly IntPtr hwnd; internal Owner(IntPtr handle) { hwnd = handle; }
            public IntPtr Handle { get { return hwnd; } }
        }
    }
}
