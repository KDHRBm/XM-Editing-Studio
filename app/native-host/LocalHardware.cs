using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Management;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private static object DetectLocalHardware() {
            double ramGB = 0, vramGB = 0;
            string gpuName = "未检测到独立显卡";
            try {
                using (var search = new ManagementObjectSearcher("SELECT TotalPhysicalMemory FROM Win32_ComputerSystem"))
                foreach (ManagementObject item in search.Get()) {
                    ramGB = Math.Round(Convert.ToDouble(item["TotalPhysicalMemory"], CultureInfo.InvariantCulture) / 1073741824.0, 1);
                    break;
                }
            } catch { /* A restricted WMI service may be unavailable. */ }
            try {
                using (var search = new ManagementObjectSearcher("SELECT Name, AdapterRAM FROM Win32_VideoController"))
                foreach (ManagementObject item in search.Get()) {
                    double reported = item["AdapterRAM"] == null ? 0 : Convert.ToDouble(item["AdapterRAM"], CultureInfo.InvariantCulture) / 1073741824.0;
                    if (reported > vramGB) { vramGB = Math.Round(reported, 1); gpuName = Convert.ToString(item["Name"]); }
                }
            } catch { /* Keep a conservative recommendation when WMI fails. */ }
            string nvidia = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "nvidia-smi.exe");
            if (File.Exists(nvidia)) {
                try {
                    using (var process = new Process()) {
                        process.StartInfo = new ProcessStartInfo(nvidia, "--query-gpu=name,memory.total --format=csv,noheader,nounits") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
                        process.Start();
                        if (!process.WaitForExit(3000)) { process.Kill(); }
                        else if (process.ExitCode == 0) foreach (string line in process.StandardOutput.ReadToEnd().Split('\n')) {
                            int comma = line.LastIndexOf(','); if (comma < 0) continue;
                            double mib;
                            if (!double.TryParse(line.Substring(comma + 1).Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out mib)) continue;
                            if (mib / 1024 > vramGB) { vramGB = Math.Round(mib / 1024, 1); gpuName = line.Substring(0, comma).Trim(); }
                        }
                    }
                } catch { /* WMI result remains available. */ }
            }
            return J.Obj("ramGB", ramGB, "vramGB", vramGB, "gpuName", gpuName);
        }
    }
}
