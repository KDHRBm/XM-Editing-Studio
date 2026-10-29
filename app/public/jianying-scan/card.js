let current, acting = false;
const $ = id => document.getElementById(id);
const titles = { preparing: '准备截图', locating: '正在定位草稿分区', analyzing: 'AI 正在识别草稿', organizing: '正在整理结果', complete: '扫描完成', error: '扫描失败', cancelled: '扫描已中断' };
const terminal = () => ['complete', 'error', 'cancelled'].includes(current?.stage);
function elapsed() {
  if (!current) return;
  const seconds = Math.max(0, Math.floor(((current.finishedAt || Date.now()) - current.startedAt) / 1000));
  $('elapsed').textContent = `已用时 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function render(value) {
  if (!value) return;
  current = value;
  const exporting = value.operation === 'export', recording = value.operation === 'recording', activeManual = (exporting || recording) && !terminal();
  const exportTitles = { preparing: '准备导出', running: `正在导出 ${value.current}/${value.total}`, stopping: '正在结束运行', complete: value.mode === 'return_home' ? '导出任务已提交' : '导出完成', error: '导出已停止', cancelled: '导出运行已结束' };
  const recordingTitles = { preparing: `录制坐标 ${value.current}/${value.total}`, recording: `录制坐标 ${value.current}/${value.total}`, retry: '请重试当前录制步骤', complete: '坐标录制完成', error: '录制失败', cancelled: '录制已结束' };
  const title = recording ? recordingTitles[value.stage] : exporting ? exportTitles[value.stage] : titles[value.stage];
  document.body.dataset.stage = value.stage;
  document.body.dataset.terminal = String(terminal());
  document.body.dataset.operation = recording ? 'recording' : exporting ? 'export' : 'scan';
  $('operation').textContent = recording ? '录制坐标向导' : exporting ? '批量导出草稿' : 'AI 扫描草稿';
  $('title').textContent = title || '正在处理';
  $('message').textContent = value.message;
  $('icon').textContent = terminal() ? value.stage === 'complete' ? '✓' : value.stage === 'error' ? '!' : '—' : '';
  $('stop').hidden = terminal() || activeManual;
  $('dismiss').hidden = activeManual;
  $('stop').disabled = acting;
  $('open').hidden = activeManual;
  $('open').disabled = value.stage === 'preparing' || activeManual;
  $('shortcut').hidden = !activeManual;
  $('shortcut').innerHTML = recording ? '按 <kbd>F8</kbd> 记录坐标 · <kbd>F10</kbd> 结束录制' : value.stage === 'stopping' ? '正在结束运行，请稍候' : '按 <kbd>F10</kbd> 结束运行';
  $('open').textContent = value.stage === 'complete' ? '查看结果' : '返回工作台';
  $('progress').setAttribute('aria-label', title);
  const determinate = (exporting || recording) && value.total > 0;
  $('progress').dataset.determinate = String(determinate);
  if (determinate) {
    $('progress').setAttribute('aria-valuemax', String(value.total));
    $('progress').setAttribute('aria-valuenow', String(value.completed));
    $('progress').setAttribute('aria-valuetext', `${recording ? '已记录' : value.mode === 'return_home' ? '已提交' : '已完成'} ${value.completed}/${value.total}`);
    $('progress').firstElementChild.style.width = `${Math.round(value.completed / value.total * 100)}%`;
  } else {
    $('progress').removeAttribute('aria-valuemax');
    $('progress').removeAttribute('aria-valuetext');
    $('progress').firstElementChild.style.width = '';
    if (value.stage === 'complete') $('progress').setAttribute('aria-valuenow', '100');
    else $('progress').removeAttribute('aria-valuenow');
  }
  elapsed();
}
for (const action of ['dismiss', 'stop', 'open']) $(action).addEventListener('click', async () => {
  if (acting) return;
  acting = true; render(current);
  try { await window.scanCard.action(action); }
  catch { $('message').textContent = '操作未完成，请返回工作台重试。'; }
  finally { acting = false; $('stop').disabled = false; }
});
window.scanCard.subscribe(render);
window.scanCard.state().then(value => { if (!current) render(value); }).catch(() => { $('message').textContent = '无法读取进度，请返回工作台查看。'; });
setInterval(elapsed, 1000);
