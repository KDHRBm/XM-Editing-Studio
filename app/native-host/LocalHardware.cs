using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Management;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private static object DetectLocalHardware() {
            double ramGB = 0, vramGB = 0;
            bool hasAmd = false, hasNvidia = false;
            string gpuName = "未检测到独立显卡";
            try {
                using (var search = new ManagementObjectSearcher("SELECT TotalPhysicalMemory FROM Win32_ComputerSystem"))
                foreach (ManagementObject item in search.Get()) {
                    ramGB = Math.Round(Convert.ToDouble(item["TotalPhysicalMemory"], CultureInfo.InvariantCulture) / 1073741824.0, 1);
                    break;
                }
            } catch { /* A restricted WMI service may be unavailable. */ }
            try {
                using (var search = new ManagementObjectSearcher("SELECT Name, AdapterRAM, PNPDeviceID FROM Win32_VideoController"))
                foreach (ManagementObject item in search.Get()) {
                    string description = Convert.ToString(item["Name"]), device = Convert.ToString(item["PNPDeviceID"]);
                    hasAmd |= device.IndexOf("VEN_1002", StringComparison.OrdinalIgnoreCase) >= 0 || description.IndexOf("Radeon", StringComparison.OrdinalIgnoreCase) >= 0;
                    hasNvidia |= device.IndexOf("VEN_10DE", StringComparison.OrdinalIgnoreCase) >= 0 || description.IndexOf("NVIDIA", StringComparison.OrdinalIgnoreCase) >= 0;
                    double reported = item["AdapterRAM"] == null ? 0 : Convert.ToDouble(item["AdapterRAM"], CultureInfo.InvariantCulture) / 1073741824.0;
                    if (reported > vramGB || gpuName == "未检测到独立显卡" && (hasAmd || hasNvidia)) { vramGB = Math.Round(reported, 1); gpuName = description; }
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
                            hasNvidia = true;
                            if (mib / 1024 > vramGB) { vramGB = Math.Round(mib / 1024, 1); gpuName = line.Substring(0, comma).Trim(); }
                        }
                    }
                } catch { /* WMI result remains available. */ }
            }
            return J.Obj("ramGB", ramGB, "vramGB", vramGB, "gpuName", gpuName, "hasAmd", hasAmd, "hasNvidia", hasNvidia);
        }
    }
}
