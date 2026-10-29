using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace XM.Native {
    internal sealed partial class StudioHost {
        private string[] pendingDrop = new string[0];
        private bool dropScanning, petRename;
        private string dropNotice = "";
        private async Task ReceivePetDrop(string[] paths) {
            if (dropScanning || pendingDrop.Length > 0) { Notify("请先处理或取消当前拖放任务。"); return; }
            dropScanning = true;
            try {
                pendingDrop = await Task.Run(() => DropFiles.Expand(paths));
                if (pendingDrop.Length == 0) throw new Exception("没有找到支持的视频、字幕或音频文件。");
                dropNotice = ""; await OpenPetPanel();
            } catch (Exception error) { Notify(error.Message); }
            finally { dropScanning = false; }
            await BroadcastPet();
        }
        private async Task ChoosePetDrop(string choice) {
            if (choice == "cancel") { pendingDrop = new string[0]; return; }
            if (pendingDrop.Length == 0) throw new Exception("请先把文件或文件夹拖到桌宠上。");
            if (choice == "rename") {
                if (J.Bool(jyState, "busy") || J.Bool(jyState, "recording")) throw new Exception("请等待当前剪映任务完成。");
                jyState = await jyEngine.Call("files", J.Obj("files", pendingDrop));
                pendingDrop = new string[0]; petRename = true; await OpenPetPanel();
            } else if (choice == "watermark") {
                if (wmRunning || wmJobs.Any(x => J.Str(x, "status") == "pending")) throw new Exception("请先完成水印队列，再处理桌宠收到的视频。");
                var files = pendingDrop.Where(x => DropFiles.VideoExtensions.Contains(Path.GetExtension(x), StringComparer.OrdinalIgnoreCase)).ToArray();
                if (files.Length == 0) throw new Exception("拖入内容中没有可加水印的视频。");
                foreach (var batch in files.Select((file, i) => new { file, i }).GroupBy(x => x.i / 100)) await WatermarkAction("add-videos", batch.Select(x => (object)x.file).ToArray());
                foreach (var job in wmJobs.Where(x => J.Str(x, "status") == "pending")) job["sourceDirectory"] = true;
                pendingDrop = new string[0]; petRename = false;
                dropNotice = "正在处理，成片保存到原文件旁，原视频保留。";
                await WatermarkAction("start", null);
            } else throw new Exception("未知的拖放操作。");
        }
    }
}
