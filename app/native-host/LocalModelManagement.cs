using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private readonly object localInferenceSync = new object();
        private int localInferenceRequests;
        private bool localModelMutating;
        private bool LocalInferenceActive { get { lock (localInferenceSync) return localInferenceRequests > 0; } }
        private void BeginLocalInference() {
            lock (localInferenceSync) {
                if (localModelMutating) throw new Exception("模型管理操作正在进行，请完成后再分析。");
                localInferenceRequests++;
            }
        }
        private void EndLocalInference() { lock (localInferenceSync) localInferenceRequests--; }
        private void BeginLocalModelMutation() {
            lock (localInferenceSync) {
                if (localInferenceRequests > 0) throw new Exception("本地模型正在分析，请等待分析结束后再管理模型。");
                if (localModelMutating) throw new Exception("已有模型管理操作正在进行。");
                localModelMutating = true;
            }
        }
        private async Task SendLocalModelOperation(string model, bool delete) {
            using (var cts = new CancellationTokenSource(60000))
            using (var request = new HttpRequestMessage(delete ? HttpMethod.Delete : HttpMethod.Post, LocalModelHost + (delete ? "/api/delete" : "/api/generate"))) {
                object payload = delete ? J.Obj("model", model) : J.Obj("model", model, "keep_alive", 0, "stream", false);
                request.Content = new StringContent(J.Encode(payload), Encoding.UTF8, "application/json");
                using (var response = await http.SendAsync(request, cts.Token)) {
                    string text = await response.Content.ReadAsStringAsync();
                    if (!response.IsSuccessStatusCode) throw new Exception("模型操作失败（" + (int)response.StatusCode + "），请刷新状态后重试。");
                    if (!string.IsNullOrWhiteSpace(text)) {
                        string error = J.Str(J.Decode(text), "error");
                        if (error.Length > 0) throw new Exception(error);
                    }
                }
            }
        }
        private async Task<object> ManageLocalModel(string action, string model, object settings) {
            if (action == "open-model-folder") {
                Directory.CreateDirectory(LocalModelsPath);
                Process.Start(new ProcessStartInfo("explorer.exe", J.Quote(LocalModelsPath)) { UseShellExecute = true });
                return await LocalModelStatus();
            }
            if (action == "delete-model" && J.Str(settings, "confirmModel") != model) throw new Exception("请先确认需要删除的模型。");
            if (!await localModelGate.WaitAsync(0)) throw new Exception("模型正在下载或管理，请稍后重试。");
            bool mutation = false;
            try {
                BeginLocalModelMutation(); mutation = true;
                var snapshot = await Task.Run(() => LocalModelInventory.Read(LocalModelsPath));
                if (!J.Arr(J.Get(snapshot, "models")).Any(m => J.Str(m, "name") == model)) throw new Exception("模型已不存在或不属于当前安装目录，请刷新列表。");
                // This refuses a foreign service on the same port. Only our server
                // has the installation's OLLAMA_MODELS path and may delete its tags.
                await StartLocalModelServer();
                if (localModelServer == null || localModelServer.HasExited) throw new Exception("请先启动剪辑台自己的本地服务。");
                if (action == "delete-model") {
                    object before = await LocalModelStatus();
                    if (J.Arr(J.Get(J.Get(before, "acceleration"), "models")).Any(m => J.Str(m, "name") == model)) await SendLocalModelOperation(model, false);
                }
                await SendLocalModelOperation(model, action == "delete-model");
                object next = await LocalModelStatus();
                if (action == "delete-model" && J.Arr(J.Get(next, "models")).Any(m => Convert.ToString(m) == model))
                    throw new Exception("模型仍在列表中，删除未能完成，请刷新后重试。");
                if (action == "unload-model" && J.Arr(J.Get(J.Get(next, "acceleration"), "models")).Any(m => J.Str(m, "name") == model))
                    throw new Exception("模型仍在内存中，请等待当前任务结束后重试。");
                return next;
            } finally {
                if (mutation) lock (localInferenceSync) localModelMutating = false;
                localModelGate.Release();
            }
        }
    }
}
