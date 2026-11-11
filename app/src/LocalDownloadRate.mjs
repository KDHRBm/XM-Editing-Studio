export function createDownloadRateTracker() {
  let transfer = '';
  let samples = [];
  let lastChange = 0;

  return {
    reset() { transfer = ''; samples = []; lastChange = 0; },
    update(progress, now = Date.now()) {
      const completed = Number(progress?.completed);
      const total = Number(progress?.total);
      if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0 || completed < 0 || completed > total) {
        transfer = ''; samples = []; lastChange = 0;
        return;
      }
      const key = `${progress.stage}:${progress.message}:${total}`;
      if (key !== transfer || (samples.length && completed < samples[samples.length - 1].completed)) {
        transfer = key;
        samples = [{ now, completed }];
        lastChange = now;
        return;
      }
      if (completed > samples[samples.length - 1].completed) {
        samples.push({ now, completed });
        lastChange = now;
        while (samples.length > 2 && now - samples[0].now > 10000) samples.shift();
      }
    },
    read(progress, now = Date.now()) {
      if (!progress?.total || progress.completed >= progress.total || samples.length < 2 || now - lastChange > 10000) return null;
      const elapsed = (samples[samples.length - 1].now - samples[0].now) / 1000;
      if (elapsed <= 0) return null;
      const bytesPerSecond = (samples[samples.length - 1].completed - samples[0].completed) / elapsed;
      if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
      return { bytesPerSecond, remainingSeconds: Math.ceil((progress.total - progress.completed) / bytesPerSecond) };
    },
  };
}

export function formatDownloadRate(bytesPerSecond) {
  return bytesPerSecond >= 1024 * 1024
    ? `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
    : `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}

export function formatRemainingTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '计算中';
  if (seconds < 60) return '不到 1 分钟';
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟`;
  return `约 ${Math.floor(seconds / 3600)} 小时 ${Math.ceil(seconds % 3600 / 60)} 分钟`;
}
