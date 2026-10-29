using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

internal sealed partial class JianYingEngine
{
    private string _recordingError = "";
    private string _lastStopSource = "";

    private void EmitProgress(Dictionary<string, object> state, string channel, string stage, string message)
    {
        if (state == null) return;
        state["stage"] = stage; state["message"] = message;
        var payload = new Dictionary<string, object>(state);
        payload["event"] = channel;
        Send(payload);
    }

    private void BeginRecordingProgress()
    {
        lock (_lock)
        {
            _stopFlag = false; _operationGeneration++;
            _recordingError = ""; _notice = "";
            _recordingProgress = new Dictionary<string, object> {
                { "id", Guid.NewGuid().ToString("N") }, { "operation", "recording" },
                { "mode", _exportMode }, { "total", _exportMode == "wait_close" ? 4 : 3 }
            };
            Send(new Dictionary<string, object> { { "event", "minimize" } });
            SyncRecordingProgress("preparing");
        }
    }

    private void SyncRecordingProgress(string stage = "recording")
    {
        if (_recState == null || _recordingProgress == null) return;
        string[] steps = _exportMode == "wait_close" ? new[] { "export", "confirm", "close_btn", "draft_close" } : new[] { "export", "confirm", "popup_close" };
        _recordingProgress["current"] = Array.IndexOf(steps, _recState) + 1;
        _recordingProgress["completed"] = steps.Count(key => _recordingCoords[key] != null);
        _recordingProgress["step"] = _recState;
        _recordingProgress["skipAvailable"] = false;
        EmitProgress(_recordingProgress, "recording-progress", stage, _guide + " · F10 结束录制");
    }

    private void OnKeyF8()
    {
        CaptureAck ack;
        NativeWin32.POINT point;
        int generation;
        string step;
        lock (_lock)
        {
            if (_recState == null || _recordingCoords == null || _recordingCapture != null) return;
            // Sampling a hovered button must not require focus or send a mouse click.
            if (!NativeWin32.GetCursorPos(out point)) { _recordingError = "无法获取鼠标位置，请重按 F8。"; EmitProgress(_recordingProgress, "recording-progress", "retry", _recordingError); return; }
            step = _recState; generation = _operationGeneration;
            ack = new CaptureAck { Id = Convert.ToString(_recordingProgress["id"]), Token = Guid.NewGuid().ToString("N") };
            _recordingCapture = ack;
        }
        // Never block the hotkey listener or hold _lock while Electron hides the card.
        // F10 remains responsive even if the renderer cannot acknowledge the capture.
        ThreadPool.QueueUserWorkItem(_ => {
            try
            {
                Send(new Dictionary<string, object> { { "event", "recording-capture" }, { "id", ack.Id }, { "token", ack.Token } });
                WaitForCapture(ack, generation, 3);
                lock (_lock)
                {
                    CheckInterrupted(generation);
                    if (_recState != step || _recordingCapture != ack) return;
                    int[] resolution = GetScreenResolution();
                    if (point.X < 0 || point.Y < 0 || point.X >= resolution[0] || point.Y >= resolution[1]) throw new InvalidOperationException("请在主屏幕的剪映窗口录制坐标。");
                    int[] color = step == "popup_close" ? GetPixelRgb(point.X, point.Y) : null;
                    _recordingCoords[step] = new[] { point.X, point.Y };
                    _recordingError = "";
                    Log(string.Format("已录制 {0} ({1},{2})", step, point.X, point.Y));
                    if (step == "popup_close") { _recordingColor = color; FinishRecording(); }
                    else AdvanceRecording();
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception error)
            {
                lock (_lock)
                {
                    if (_recState == step && generation == _operationGeneration)
                    {
                        _recordingError = "录制失败：" + error.Message + " 请重按 F8。";
                        Log(_recordingError);
                        EmitProgress(_recordingProgress, "recording-progress", "retry", _recordingError);
                    }
                }
            }
            finally { lock (_lock) { if (_recordingCapture == ack) _recordingCapture = null; } }
        });
    }

    private void BeginExportProgress(int startIndex, string mode, List<Tuple<int, int, string>> drafts, Dictionary<string, int[]> coords)
    {
        lock (_lock)
        {
            _lastStopSource = "";
            _exportProgress = new Dictionary<string, object> {
                { "id", Guid.NewGuid().ToString("N") }, { "operation", "export" }, { "mode", mode },
                { "total", drafts.Count - startIndex }, { "completed", 0 }, { "current", 0 }, { "draftName", "" },
                { "avoid", coords.Values.Where(p => p != null).Concat(drafts.Skip(startIndex).Select(d => new[] { d.Item1, d.Item2 })).ToList() }
            };
            EmitProgress(_exportProgress, "export-progress", "preparing", "准备执行导出任务 · 按 F10 结束运行");
        }
    }

    private void ExportStep(int current, string name, bool completed)
    {
        lock (_lock)
        {
            _exportProgress["current"] = current; _exportProgress["draftName"] = name;
            if (completed) _exportProgress["completed"] = current;
            string verb = completed ? (Convert.ToString(_exportProgress["mode"]) == "return_home" ? "已提交后台导出" : "已完成导出") : "正在处理";
            EmitProgress(_exportProgress, "export-progress", "running", string.Format("{0} {1}/{2}：{3} · F10 结束运行", verb, current, _exportProgress["total"], name));
        }
    }

    private void FinishExportProgress(string mode, Exception error)
    {
        lock (_lock)
        {
            if (_exportProgress == null) return;
            string count = _exportProgress["completed"] + "/" + _exportProgress["total"];
            bool cancelled = error is OperationCanceledException;
            string message = error == null ? (mode == "return_home" ? "已提交 " + count + " 个草稿，剪映正在后台导出" : "导出完成，共 " + count + " 个草稿") :
                cancelled ? (_lastStopSource == "F10" ? "已按 F10 结束运行" : "导出运行已结束") + "，" + (mode == "return_home" ? "已提交 " : "已完成 ") + count + " 个草稿" + (mode == "return_home" ? "；已提交的任务仍由剪映处理" : "") :
                "导出已停止（" + count + "）：" + error.Message;
            _notice = message; _status = message; Log(message);
            EmitProgress(_exportProgress, "export-progress", error == null ? "complete" : cancelled ? "cancelled" : "error", message);
        }
    }
}
