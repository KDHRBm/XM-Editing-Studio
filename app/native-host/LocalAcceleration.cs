using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;

namespace XM.Native {
    internal static class LocalAcceleration {
        internal static object Normalize(object value) {
            string mode = J.Str(value, "mode", "auto"), device = J.Str(value, "vulkanDevice").Trim();
            if (!new[] { "auto", "vulkan", "rocm", "cpu" }.Contains(mode)) throw new Exception("请选择有效的本地加速方式。");
            if (device.Length > 0 && !Regex.IsMatch(device, @"^\d{1,2}(,\d{1,2})*$")) throw new Exception("Vulkan 设备编号需为 0、1 或逗号分隔的编号；留空自动选择。");
            return J.Obj("mode", mode, "vulkanDevice", device);
        }
        internal static string Backend(string runtime, string prefix) {
            string root = Path.Combine(runtime, "lib", "ollama");
            if (!Directory.Exists(root)) return "";
            return Directory.GetDirectories(root).OrderByDescending(p => p, StringComparer.OrdinalIgnoreCase)
                .Where(p => Path.GetFileName(p).StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                .Where(p => File.Exists(Path.Combine(p, "llama-server.exe")) || File.Exists(Path.Combine(p, "libllama-server-impl.dll"))
                    || File.Exists(Path.Combine(p, "ggml-vulkan.dll")) || File.Exists(Path.Combine(p, "ggml-hip.dll")))
                .Select(Path.GetFileName).FirstOrDefault() ?? "";
        }
        internal static bool HasAmd(object hardware) {
            return J.Bool(hardware, "hasAmd") || Regex.IsMatch(J.Str(hardware, "gpuName"), "AMD|Radeon", RegexOptions.IgnoreCase);
        }
        internal static string Resolve(object settings, object hardware, string runtime) {
            string mode = J.Str(settings, "mode", "auto");
            if (mode == "auto" && HasAmd(hardware) && !J.Bool(hardware, "hasNvidia")
                && Backend(runtime, "rocm").Length == 0 && Backend(runtime, "vulkan").Length > 0) return "vulkan";
            return mode;
        }
        internal static void Apply(ProcessStartInfo info, object settings, object hardware, string runtime) {
            string mode = Resolve(settings, hardware, runtime);
            if (mode == "auto") return; // Preserve existing CUDA/ROCm device selection on other systems.
            if (mode == "vulkan" && Backend(runtime, "vulkan").Length == 0) throw new Exception("当前运行环境缺少 Vulkan 组件，请更新完整 Ollama Windows 运行环境后重试。");
            if (mode == "rocm" && Backend(runtime, "rocm").Length == 0) throw new Exception("当前运行环境未安装 ROCm 组件；RX 6500 XT 请选 Vulkan 兼容。");
            // These settings belong to this child process only. A copied/global CPU
            // override must not silently disable the GPU selected in this app.
            foreach (string key in new[] { "OLLAMA_LLM_LIBRARY", "CUDA_VISIBLE_DEVICES", "HIP_VISIBLE_DEVICES", "ROCR_VISIBLE_DEVICES", "GPU_DEVICE_ORDINAL", "GGML_VK_VISIBLE_DEVICES" })
                info.EnvironmentVariables.Remove(key);
            info.EnvironmentVariables["OLLAMA_VULKAN"] = mode == "cpu" || mode == "rocm" ? "0" : "1";
            if (mode == "vulkan") {
                info.EnvironmentVariables["OLLAMA_LLM_LIBRARY"] = Backend(runtime, "vulkan");
                if (J.Str(settings, "vulkanDevice").Length > 0) info.EnvironmentVariables["GGML_VK_VISIBLE_DEVICES"] = J.Str(settings, "vulkanDevice");
            } else if (mode == "rocm") info.EnvironmentVariables["OLLAMA_LLM_LIBRARY"] = Backend(runtime, "rocm");
            else if (mode == "cpu") {
                info.EnvironmentVariables["OLLAMA_LLM_LIBRARY"] = "cpu";
                foreach (string key in new[] { "CUDA_VISIBLE_DEVICES", "HIP_VISIBLE_DEVICES", "ROCR_VISIBLE_DEVICES", "GGML_VK_VISIBLE_DEVICES" }) info.EnvironmentVariables[key] = "-1";
            }
        }
        internal static object Usage(object payload) {
            if (payload == null || !(J.Get(payload, "models") is System.Collections.IList)) return J.Obj("usageState", "unknown", "models", new object[0]);
            var models = J.Arr(J.Get(payload, "models")).Select(m => J.Obj("name", J.Str(m, "name", J.Str(m, "model")),
                "sizeBytes", J.Num(m, "size", -1), "vramBytes", J.Num(m, "size_vram", -1))).ToArray();
            string state = models.Length == 0 ? "idle" : models.Any(m => J.Num(m, "vramBytes", -1) > 0) ? "gpu"
                : models.All(m => J.Num(m, "vramBytes", -1) == 0) ? "cpu" : "unknown";
            return J.Obj("usageState", state, "models", models);
        }
    }

    internal sealed partial class StudioHost {
        private object localAccelerationActive;
        private string LocalAccelerationPath { get { return Path.Combine(LocalModelRoot, "acceleration.json"); } }
        private object ReadLocalAcceleration() {
            try { return LocalAcceleration.Normalize(J.Read(LocalAccelerationPath, null)); }
            catch { return LocalAcceleration.Normalize(null); }
        }
        private async Task<object> LocalAccelerationStatus(bool running, object hardware) {
            object usage = LocalAcceleration.Usage(null);
            if (running) try {
                using (var cts = new CancellationTokenSource(1500))
                using (var response = await http.GetAsync(LocalModelHost + "/api/ps", cts.Token)) {
                    if (response.IsSuccessStatusCode) usage = LocalAcceleration.Usage(J.Decode(await response.Content.ReadAsStringAsync()));
                }
            } catch { /* Unknown usage must not appear as CPU-only or idle. */ }
            object settings = ReadLocalAcceleration();
            bool owned = localModelServer != null && !localModelServer.HasExited;
            return J.Obj("settings", settings, "resolvedMode", LocalAcceleration.Resolve(settings, hardware, LocalRuntime),
                "activeSettings", owned ? localAccelerationActive : null,
                "restartRequired", running && (!owned || J.Encode(settings) != J.Encode(localAccelerationActive)),
                "managed", owned, "vulkanInstalled", LocalAcceleration.Backend(LocalRuntime, "vulkan").Length > 0,
                "rocmInstalled", LocalAcceleration.Backend(LocalRuntime, "rocm").Length > 0,
                "hasAmd", LocalAcceleration.HasAmd(hardware), "usageState", running ? J.Str(usage, "usageState") : "stopped", "models", J.Get(usage, "models"));
        }
        private async Task<object> SaveLocalAcceleration(object value) {
            object settings = LocalAcceleration.Normalize(value);
            // Validate component availability before persisting an unusable choice.
            LocalAcceleration.Apply(new ProcessStartInfo(), settings, localHardware ?? (localHardware = await Task.Run(() => DetectLocalHardware())), LocalRuntime);
            J.Save(LocalAccelerationPath, settings);
            return await LocalModelStatus();
        }
    }
}
