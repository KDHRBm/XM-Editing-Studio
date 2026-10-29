using System;
using System.Linq;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Threading;
using System.Windows.Forms;

namespace XM.Native {
    internal sealed partial class StudioHost {
        [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
        private readonly System.Windows.Forms.Timer clipboardTimer = new System.Windows.Forms.Timer { Interval = 100 };
        private bool workspacePeriod, batchPeriod, clipboardBusy;
        private string punctuationMode = "compatible", clipboardError = "", originalCopy, protectedCopy;
        private uint clipboardSequence;
        private object periodState = J.Obj("enabled", false, "engine", "offline");
        private readonly SemaphoreSlim periodGate = new SemaphoreSlim(1, 1), clipboardGate = new SemaphoreSlim(1, 1);
        private int copyGeneration, protectionGeneration;
        private static string Protect(string value) {
            return Regex.Replace(value.Replace("\u2060", ""), @"[ \t\u3000]*(\.{2,}|[.,。，])", m => {
                string p = m.Groups[1].Value;
                if (p.Length >= 2) return m.Value.Replace('.', '․');
                return p == "." ? "․" : p == "," ? "‚" : p == "。" ? "﹒" : "﹐";
            });
        }
        private static string Canonical(string value) { return value.Replace("\r\n", "\n").Replace("\r", "\n"); }
        private static bool OtherClipboard() { return Clipboard.ContainsImage() || Clipboard.ContainsFileDropList(); }
        private void InitClipboard() {
            clipboardSequence = GetClipboardSequenceNumber();
            clipboardTimer.Tick += async (s, e) => {
                if (!workspacePeriod || punctuationMode != "compatible" || clipboardBusy) return;
                uint seq = GetClipboardSequenceNumber(); if (seq == clipboardSequence) return;
                try {
                    if (OtherClipboard() || !Clipboard.ContainsText()) { clipboardSequence = seq; return; }
                    string text = Clipboard.GetText(); if (text.Length > 120000) { clipboardSequence = seq; return; }
                    string output = Protect(text); originalCopy = protectedCopy = null;
                    if (output != text) await WriteClipboard(text, output, seq); else clipboardSequence = seq;
                } catch (Exception error) { clipboardError = error.Message; }
            };
            clipboardTimer.Start();
        }
        private object PeriodView() { var value = new Dictionary<string, object>(J.Map(periodState)); value["enabled"] = workspacePeriod; value["batchEnabled"] = batchPeriod; value["nativeEnabled"] = workspacePeriod || batchPeriod; value["punctuationMode"] = punctuationMode; value["clipboardProtected"] = workspacePeriod && punctuationMode == "compatible" && clipboardError.Length == 0; value["clipboardError"] = clipboardError; return value; }
        private async Task<object> PeriodStatus(string action) { try { periodState = await periodEngine.Call(action, null, true); } catch (Exception error) { periodState = J.Obj("enabled", false, "engine", "standby", "error", error.Message); } return PeriodView(); }
        private async Task<object> ConfigurePeriod(bool enabled, string mode, bool batch) {
            if (mode != "compatible" && mode != "standard") throw new Exception("无效的标点模式。");
            await periodGate.WaitAsync();
            try {
                if (batch) batchPeriod = enabled; else { workspacePeriod = enabled; punctuationMode = mode; protectionGeneration++; if (!enabled || mode != "compatible") RestoreClipboard(); }
                try { periodState = await periodEngine.Call(workspacePeriod || batchPeriod ? "enable" : "disable", null, true); }
                catch (Exception error) { periodState = J.Obj("enabled", false, "engine", "standby", "error", error.Message); }
                return PeriodView();
            } finally { periodGate.Release(); }
        }
        private async Task<object> WriteClipboard(string original, string output, uint? expected = null) {
            int generation = expected.HasValue ? copyGeneration : ++copyGeneration, protectEpoch = protectionGeneration;
            await clipboardGate.WaitAsync();
            clipboardBusy = true;
            try {
                uint? observed = expected;
                for (int attempt = 0; attempt < 6; attempt++) {
                    try {
                        if (generation != copyGeneration || expected.HasValue && protectEpoch != protectionGeneration) throw new InvalidOperationException("复制操作已被新的操作替代。");
                        if (observed.HasValue && observed.Value != GetClipboardSequenceNumber()) throw new InvalidOperationException("剪贴板已被其他操作更新，请重新复制。");
                        Clipboard.SetText(Canonical(output).Replace("\n", "\r\n"));
                        observed = GetClipboardSequenceNumber();
                        if (Canonical(Clipboard.GetText()) == Canonical(output)) {
                            originalCopy = original; protectedCopy = original != output ? output : null; clipboardSequence = observed.Value; clipboardError = "";
                            return J.Obj("copyVerified", true, "copiedCharacters", Canonical(original).Length, "copiedLines", Canonical(original).Split('\n').Count(x => !string.IsNullOrWhiteSpace(x)));
                        }
                    } catch (System.Runtime.InteropServices.ExternalException) { /* Another app holds the clipboard; retry without losing the original. */ }
                    await Task.Delay(30);
                }
                throw new Exception("复制完整性校验失败，请重试。");
            } finally { clipboardBusy = false; clipboardGate.Release(); }
        }
        private async Task<object> CopySubtitle(string text, object options) {
            if (text.Length > 120000) throw new Exception("字幕台词过长。");
            bool protect = J.Get(options, "protect") is bool ? J.Bool(options, "protect") : workspacePeriod && punctuationMode == "compatible";
            text = Canonical(text.Replace("\0", ""));
            text = Regex.Replace(text.Replace("\u2060", ""), "[․﹒。．]", "."); text = Regex.Replace(text, "[‚﹐，]", ","); text = Regex.Replace(text, "[‥…]", "...");
            text = Regex.Replace(text, @"\.(?:[ \t\u3000]*\.)+", "..."); text = Regex.Replace(text, @"[ \t\u3000]+([.,])", "$1");
            var result = J.Map(await WriteClipboard(text, protect ? Protect(text) : text)); result["clipboardProtected"] = protect;
            if (protect && !batchPeriod) {
                // Copy immediately; native process scanning is independent and may take seconds.
                Task<object> activation = ConfigurePeriod(true, "compatible", true);
                activation.ContinueWith(t => { if (t.IsFaulted) Log("period-enable " + t.Exception.GetBaseException().Message); });
                result["warning"] = "复制文本已完成保护，标点组件正在后台准备。";
            }
            return result;
        }
        private void RestoreClipboard() { try { if (protectedCopy != null && !OtherClipboard() && Canonical(Clipboard.GetText()) == Canonical(protectedCopy)) Clipboard.SetText(Canonical(originalCopy).Replace("\n", "\r\n")); } catch {} originalCopy = protectedCopy = null; clipboardSequence = GetClipboardSequenceNumber(); }
        private void StopClipboard() { clipboardTimer.Stop(); RestoreClipboard(); }
    }
}
