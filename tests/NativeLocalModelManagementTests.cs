using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private string DataDir;
        private HttpClient http;
        private void Emit(string name, object value) {}
        private void Log(string text) {}
        private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
        private static bool Reject(Action action) { try { action(); return false; } catch { return true; } }
        private sealed class FakeOllama : HttpMessageHandler {
            internal StudioHost Host;
            internal bool Running = true, Loaded, FailDelete;
            internal int Deletes, Unloads;
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
                Check(request.RequestUri.Host == "127.0.0.1" && request.RequestUri.Port == 11435, "Never send a model operation to a remote endpoint.");
                if (!Running) return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
                string path = request.RequestUri.AbsolutePath;
                if (path == "/api/delete") {
                    Deletes++;
                    Check(request.Method == HttpMethod.Delete, "Deletion must use the Ollama DELETE API.");
                    object value = J.Decode(await request.Content.ReadAsStringAsync());
                    Check(J.Str(value, "model") == "custom/story:latest", "Pass the exact selected model tag.");
                    if (FailDelete) return new HttpResponseMessage(HttpStatusCode.InternalServerError);
                    File.Delete(Path.Combine(Host.LocalModelsPath, "manifests", "registry.ollama.ai", "custom", "story", "latest"));
                    return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("") };
                }
                if (path == "/api/generate") {
                    Unloads++;
                    object value = J.Decode(await request.Content.ReadAsStringAsync());
                    Check(request.Method == HttpMethod.Post && J.Str(value, "model") == "custom/story:latest", "Unload selected tag only.");
                    Check(J.Num(value, "keep_alive", -1) == 0 && !J.Bool(value, "stream") && J.Get(value, "prompt") == null, "Unload without inference or a prompt.");
                    Loaded = false;
                    return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"done\":true}") };
                }
                object payload = path == "/api/ps" ? J.Obj("models", Loaded ? new[] { J.Obj("name", "custom/story:latest", "size", 100, "size_vram", 80) } : new object[0])
                    : J.Obj("models", J.Arr(J.Get(LocalModelInventory.Read(Host.LocalModelsPath), "models")).Select(m => J.Obj("name", J.Str(m, "name"))).ToArray());
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(J.Encode(payload)) };
            }
        }
        private static string AddBlob(string root, string text) {
            string digest = "sha256:" + J.Hash(text);
            string path = Path.Combine(root, "blobs", digest.Replace(':', '-'));
            Directory.CreateDirectory(Path.GetDirectoryName(path)); File.WriteAllText(path, text, new UTF8Encoding(false)); return digest;
        }
        private static void AddManifest(string root, string relative, string blob, string config) {
            string file = Path.Combine(root, "manifests", relative);
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            J.Save(file, J.Obj("schemaVersion", 2, "config", J.Obj("digest", config, "size", new FileInfo(Path.Combine(root, "blobs", config.Replace(':', '-'))).Length),
                "layers", new[] { J.Obj("digest", blob, "size", new FileInfo(Path.Combine(root, "blobs", blob.Replace(':', '-'))).Length) }));
        }
        public static int Main(string[] args) {
            if (args.Length > 0 && args[0] == "serve") { Thread.Sleep(30000); return 0; }
            if (args.Length > 1 && args[0] == "inventory") { Console.WriteLine(J.Encode(LocalModelInventory.Read(args[1]))); return 0; }
            string root = Path.Combine(Path.GetTempPath(), "xm-model-management-" + Guid.NewGuid().ToString("N"));
            var host = new StudioHost { DataDir = root, localHardware = J.Obj("ramGB", 16, "vramGB", 8) };
            var fake = new FakeOllama { Host = host };
            host.http = new HttpClient(fake);
            try {
                string blob = AddBlob(host.LocalModelsPath, "synthetic shared model weights");
                string config = AddBlob(host.LocalModelsPath, "{\"model_family\":\"test\",\"model_type\":\"4B\",\"file_type\":\"Q4\"}");
                AddManifest(host.LocalModelsPath, "registry.ollama.ai/library/qwen3.5/4b", blob, config);
                AddManifest(host.LocalModelsPath, "registry.ollama.ai/custom/story/latest", blob, config);
                object inventory = LocalModelInventory.Read(host.LocalModelsPath);
                var models = J.Arr(J.Get(inventory, "models"));
                Check(models.Length == 2 && models.All(m => J.Bool(m, "complete")), "List arbitrary local tags while stopped.");
                Check(J.Num(inventory, "bytes") == J.Num(models[0], "sizeBytes"), "Shared files counted once in total.");
                Check(models.Any(m => J.Str(m, "name") == "custom/story:latest" && J.Str(m, "quantization") == "Q4"), "Custom tags and metadata preserved.");
                fake.Running = false;
                var offline = host.LocalModelAction("status", "").GetAwaiter().GetResult();
                Check(J.Arr(J.Get(offline, "modelDetails")).Length == 2 && !J.Bool(offline, "running"), "Stopped service retains management inventory.");
                fake.Running = true;
                Check(Reject(() => host.LocalModelAction("delete-model", "custom/story:latest").GetAwaiter().GetResult()), "Delete requires exact named confirmation.");
                Check(Reject(() => host.LocalModelAction("delete-model", "../other:latest", J.Obj("confirmModel", "../other:latest")).GetAwaiter().GetResult()), "Reject names outside the scanned inventory.");
                host.BeginLocalInference();
                try {
                    Check(Reject(() => host.LocalModelAction("delete-model", "custom/story:latest", J.Obj("confirmModel", "custom/story:latest")).GetAwaiter().GetResult()), "Protect active inference.");
                    Check(Reject(() => host.LocalModelAction("unload-model", "custom/story:latest").GetAwaiter().GetResult()), "Cannot unload active inference.");
                } finally { host.EndLocalInference(); }
                host.BeginLocalModelMutation();
                try { Check(Reject(() => host.BeginLocalInference()), "Management blocks racing analysis."); }
                finally { lock (host.localInferenceSync) host.localModelMutating = false; }
                host.localModelGate.Wait();
                try { Check(Reject(() => host.LocalModelAction("delete-model", "custom/story:latest", J.Obj("confirmModel", "custom/story:latest")).GetAwaiter().GetResult()), "Concurrent download blocks deletion."); }
                finally { host.localModelGate.Release(); }
                Directory.CreateDirectory(host.LocalRuntime);
                File.Copy(System.Reflection.Assembly.GetExecutingAssembly().Location, host.LocalOllamaExe);
                Check(Reject(() => host.LocalModelAction("delete-model", "custom/story:latest", J.Obj("confirmModel", "custom/story:latest")).GetAwaiter().GetResult()), "Do not mutate an external service.");
                Check(fake.Deletes == 0, "No delete requests before authorization and ownership checks.");
                host.localModelServer = Process.Start(new ProcessStartInfo(host.LocalOllamaExe, "serve") { UseShellExecute = false, CreateNoWindow = true });
                fake.Loaded = true;
                var unloaded = host.LocalModelAction("unload-model", "custom/story:latest").GetAwaiter().GetResult();
                Check(fake.Unloads == 1 && J.Arr(J.Get(unloaded, "models")).Length == 2, "Unload keeps downloaded model files.");
                fake.FailDelete = true;
                Check(Reject(() => host.LocalModelAction("delete-model", "custom/story:latest", J.Obj("confirmModel", "custom/story:latest")).GetAwaiter().GetResult()), "Failed API delete must be surfaced.");
                Check(J.Arr(J.Get(LocalModelInventory.Read(host.LocalModelsPath), "models")).Length == 2, "Failed deletion preserves inventory.");
                fake.FailDelete = false;
                var deleted = host.LocalModelAction("delete-model", "custom/story:latest", J.Obj("confirmModel", "custom/story:latest")).GetAwaiter().GetResult();
                Check(J.Arr(J.Get(deleted, "models")).Length == 1, "Only the selected model disappears.");
                Check(File.Exists(Path.Combine(host.LocalModelsPath, "blobs", blob.Replace(':', '-'))), "Shared file stays available to the other model.");
                string remaining = Path.Combine(host.LocalModelsPath, "manifests", "registry.ollama.ai", "library", "qwen3.5", "4b");
                string original = File.ReadAllText(remaining);
                File.WriteAllText(remaining, "invalid json");
                Check(J.Str(LocalModelInventory.Read(host.LocalModelsPath), "warning").Length > 0, "Malformed manifests don't crash status.");
                File.WriteAllText(remaining, original);
                File.Delete(Path.Combine(host.LocalModelsPath, "blobs", blob.Replace(':', '-')));
                Check(!J.Bool(J.Arr(J.Get(LocalModelInventory.Read(host.LocalModelsPath), "models"))[0], "complete"), "Missing weights are not usable models.");
                Console.WriteLine("PASS: offline inventory, shared sizes, model ownership, confirmation, inference/download guards, unload and delete errors.");
                return 0;
            } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
            finally { host.StopLocalModelServer().GetAwaiter().GetResult(); host.http.Dispose(); if (Directory.Exists(root)) Directory.Delete(root, true); }
        }
    }
}
