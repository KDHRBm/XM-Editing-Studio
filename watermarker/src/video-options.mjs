export function outputDimensions(width, height, size = 'original') {
  if (!(width > 0 && height > 0)) throw new Error('视频尺寸无效。');
  const ratio = size === '720' ? Math.min(1, 1280 / width, 1280 / height, 720 / Math.min(width, height)) : 1;
  return { width: Math.max(2, Math.floor(width * ratio / 2) * 2), height: Math.max(2, Math.floor(height * ratio / 2) * 2) };
}
export function ffmpegArgs(input, output, { audio = 'copy', crf = '23', size = 'original' } = {}) {
  // Scale before overlay/encoding to reduce per-frame work for optional 720p previews.
  const scale = size === '720' ? "scale=w='if(gte(iw,ih),min(1280,iw),min(720,iw))':h='if(gte(iw,ih),min(720,ih),min(1280,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2" : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  return ['-y', '-i', input, '-i', 'watermark.png', '-filter_complex', `[0:v]${scale}[base];[1:v][base]scale2ref=w=main_w:h=main_h[wm][video];[video][wm]overlay=0:0[outv]`, '-map', '[outv]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', crf, '-tune', 'fastdecode', '-pix_fmt', 'yuv420p', '-c:a', audio, output];
}
export function preferWebAV(engine, file) {
  return engine === 'webav' || (engine === 'auto' && /\.(mp4|m4v)$/i.test(file.name));
}
