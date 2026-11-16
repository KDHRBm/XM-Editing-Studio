using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using System.Linq;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private string DataDir;
        private HttpClient http;
        private void Emit(string name, object value) {}
        private void Log(string text) {}
        private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
        private sealed class FakeOllama : HttpMessageHandler {
            public bool FailPs;
            public bool Running = true;
            public bool BadDigest;
            public byte[] RuntimeZip;
            public string Models = "[]";
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
                if (request.RequestUri.Host == "api.github.com") return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(J.Encode(J.Obj("assets", new[] { J.Obj(
                    "name", "ollama-windows-amd64.zip", "size", RuntimeZip.Length,
                    "browser_download_url", "https://github.com/ollama/ollama/releases/download/v-test/ollama-windows-amd64.zip",
                    "digest", "sha256:" + (BadDigest ? new string('0', 64) : J.Hash(RuntimeZip))) }))) });
                if (request.RequestUri.Host == "github.com") return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(RuntimeZip) });
                string path = request.RequestUri.AbsolutePath;
                if (!Running) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
                if (path == "/api/ps" && FailPs) throw new HttpRequestException("offline fixture failure");
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(path == "/api/ps" ? "{\"models\":" + Models + "}" : "{\"models\":[]}") });
            }
        }
        public static int Main() {
            string root = Path.Combine(Path.GetTempPath(), "xm-amd-test-" + Guid.NewGuid().ToString("N"));
            try {
                var fake = new FakeOllama { Models = "[{\"name\":\"qwen3.5:4b\",\"size\":5000000000,\"size_vram\":3500000000}]" };
                var host = new StudioHost { DataDir = root, http = new HttpClient(fake), localHardware = J.Obj("gpuName", "AMD Radeon RX 6800", "hasAmd", true, "vramGB", 16, "ramGB", 32) };
                object state = host.LocalModelStatus().GetAwaiter().GetResult();
                object acceleration = J.Get(state, "acceleration");
                Check(acceleration != null, "Missing real GPU residency status: service running is not proof of AMD acceleration.");
                Check(J.Str(acceleration, "usageState") == "gpu", "size_vram > 0 must report GPU participation.");
                fake.Models = "[{\"name\":\"qwen3.5:4b\",\"size\":5000000000,\"size_vram\":0}]";
                state = host.LocalModelStatus().GetAwaiter().GetResult();
                Check(J.Str(J.Get(state, "acceleration"), "usageState") == "cpu", "A model resident only in RAM must report CPU.");
                fake.Models = "[]";
                state = host.LocalModelStatus().GetAwaiter().GetResult();
                Check(J.Str(J.Get(state, "acceleration"), "usageState") == "idle", "An unloaded model is not CPU fallback.");
                fake.FailPs = true;
                state = host.LocalModelStatus().GetAwaiter().GetResult();
                Check(J.Str(J.Get(state, "acceleration"), "usageState") == "unknown", "A failed status request is not proof of CPU use.");
                string vulkan = Path.Combine(host.LocalRuntime, "lib", "ollama", "vulkan");
                Directory.CreateDirectory(vulkan); File.WriteAllText(Path.Combine(vulkan, "ggml-vulkan.dll"), "fixture");
                var start = new ProcessStartInfo();
                start.EnvironmentVariables["OLLAMA_LLM_LIBRARY"] = "cpu";
                start.EnvironmentVariables["GGML_VK_VISIBLE_DEVICES"] = "-1";
                start.EnvironmentVariables["HIP_VISIBLE_DEVICES"] = "-1";
                LocalAcceleration.Apply(start, LocalAcceleration.Normalize(null), host.localHardware, host.LocalRuntime);
                Check(start.EnvironmentVariables["OLLAMA_LLM_LIBRARY"] == "vulkan" && start.EnvironmentVariables["OLLAMA_VULKAN"] == "1", "AMD without ROCm must select its available Vulkan backend.");
                Check(start.EnvironmentVariables["GGML_VK_VISIBLE_DEVICES"] == null && start.EnvironmentVariables["HIP_VISIBLE_DEVICES"] == null, "Inherited CPU restrictions must not disable the chosen GPU.");
                start = new ProcessStartInfo(); start.EnvironmentVariables["CUDA_VISIBLE_DEVICES"] = "GPU-user-choice";
                LocalAcceleration.Apply(start, LocalAcceleration.Normalize(null), J.Obj("gpuName", "NVIDIA RTX 3050", "hasNvidia", true), host.LocalRuntime);
                Check(start.EnvironmentVariables["CUDA_VISIBLE_DEVICES"] == "GPU-user-choice", "NVIDIA auto mode must preserve existing CUDA device selection.");
                LocalAcceleration.Apply(start, LocalAcceleration.Normalize(J.Obj("mode", "cpu")), host.localHardware, host.LocalRuntime);
                Check(start.EnvironmentVariables["OLLAMA_VULKAN"] == "0" && start.EnvironmentVariables["CUDA_VISIBLE_DEVICES"] == "-1", "Explicit CPU mode must disable all GPU backends.");
                state = host.LocalModelAction("acceleration", "", J.Obj("mode", "vulkan", "vulkanDevice", "1")).GetAwaiter().GetResult();
                Check(J.Str(host.ReadLocalAcceleration(), "vulkanDevice") == "1", "Device choice must survive reading persisted settings.");
                Check(J.Bool(J.Get(state, "acceleration"), "restartRequired"), "A running service must not claim new settings are already active.");
                LocalAcceleration.Apply(start, host.ReadLocalAcceleration(), host.localHardware, host.LocalRuntime);
                Check(start.EnvironmentVariables["GGML_VK_VISIBLE_DEVICES"] == "1", "An explicit Vulkan GPU index must reach the child process.");
                bool rejected = false;
                try { host.LocalModelAction("acceleration", "", J.Obj("mode", "vulkan", "vulkanDevice", "-1")).GetAwaiter().GetResult(); } catch { rejected = true; }
                Check(rejected && J.Str(host.ReadLocalAcceleration(), "vulkanDevice") == "1", "An invalid device must not overwrite valid settings.");
                rejected = false;
                try { LocalAcceleration.Apply(start, LocalAcceleration.Normalize(J.Obj("mode", "rocm")), host.localHardware, host.LocalRuntime); } catch { rejected = true; }
                Check(rejected, "Missing ROCm must not be presented as a working backend.");
                Check(J.Str(LocalAcceleration.Usage(J.Obj("models", null)), "usageState") == "unknown", "Malformed ps responses must not look idle.");
                rejected = false;
                try { host.LocalModelAction("upgrade-runtime", "").GetAwaiter().GetResult(); } catch { rejected = true; }
                Check(rejected, "Runtime updates must not stop an active model service.");
                fake.Running = false;
                Directory.CreateDirectory(host.LocalModelsPath);
                File.WriteAllText(Path.Combine(host.LocalModelsPath, "keep-model"), "downloaded weights");
                File.WriteAllText(host.LocalOllamaExe, "old runtime");
                using (var memory = new MemoryStream()) {
                    using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, true)) {
                        using (var writer = new StreamWriter(zip.CreateEntry("ollama.exe").Open())) writer.Write("new runtime");
                        using (var writer = new StreamWriter(zip.CreateEntry("lib/ollama/vulkan/ggml-vulkan.dll").Open())) writer.Write("fixture");
                    }
                    fake.RuntimeZip = memory.ToArray();
                }
                fake.BadDigest = true; rejected = false;
                try { host.LocalModelAction("upgrade-runtime", "").GetAwaiter().GetResult(); } catch { rejected = true; }
                Check(rejected && File.ReadAllText(host.LocalOllamaExe) == "old runtime", "A bad download must preserve the installed runtime.");
                fake.BadDigest = false;
                host.LocalModelAction("upgrade-runtime", "").GetAwaiter().GetResult();
                Check(File.ReadAllText(host.LocalOllamaExe) == "new runtime", "Verified runtime must replace the old runtime.");
                Check(File.ReadAllText(Path.Combine(host.LocalModelsPath, "keep-model")) == "downloaded weights", "Runtime update must preserve model weights.");
                Check(Directory.GetDirectories(host.LocalModelRoot, "runtime-backup-*").Any(p => File.ReadAllText(Path.Combine(p, "ollama.exe")) == "old runtime"), "Runtime update must keep a recoverable backup.");
                Console.WriteLine("PASS: stopped-only upgrade, checksum failure recovery and model preservation.");
                Console.WriteLine("PASS: AMD Vulkan, NVIDIA auto, explicit CPU, persisted GPU selection and restart state.");
                Console.WriteLine("PASS: GPU / CPU / idle / unknown are distinct.");
                return 0;
            } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
            finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
        }
    }
}
