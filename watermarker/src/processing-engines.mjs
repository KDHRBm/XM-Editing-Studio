import { ffmpegArgs, outputDimensions, preferWebAV } from './video-options.mjs';
import { hardwarePreference } from './browser-session.mjs';

export function createWatermarkProcessors(deps, run, settings) {
  const { FFmpeg, fetchFile, MP4Clip, ImgClip, OffscreenSprite, Combinator, publish, status, progress, log } = deps;
  const fetcher = deps.fetcher || fetch, bitmap = deps.bitmap || createImageBitmap;
  const now = deps.now || (() => performance.now());
  let wasm, watermarkCached = false;
  const report = text => { run.check(); status(text); };
  function resetWasm() {
    if (wasm) { try { wasm.terminate(); } finally { wasm = null; watermarkCached = false; } }
  }
  run.own(resetWasm);
  async function timeout(promise, milliseconds, message) {
    let timer;
    try { return await run.wait(Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })])); }
    finally { clearTimeout(timer); }
  }
  async function loadWasm() {
    run.check();
    if (wasm?.loaded) return wasm;
    wasm = new FFmpeg();
    const engine = wasm;
    report('正在加载内置 FFmpeg 离线引擎…');
    try {
      await timeout(engine.load({ coreURL: '/watermarker/ffmpeg/ffmpeg-core.js', wasmURL: '/watermarker/ffmpeg/ffmpeg-core.wasm', classWorkerURL: '/watermarker/ffmpeg-worker/worker.js' }), 30000, 'FFmpeg 加载超时，请重试。');
      engine.on('log', ({ message }) => log(message));
      let last = 0;
      engine.on('progress', ({ progress: value }) => { if (!run.signal.aborted && performance.now() - last > 150) { last = performance.now(); progress(value * 100); } });
      return engine;
    } catch (error) { resetWasm(); throw error; }
  }
  async function execute(engine, args) {
    let lastActivity = performance.now(), timer;
    const poke = () => { lastActivity = performance.now(); };
    engine.on('log', poke); engine.on('progress', poke);
    try {
      return await run.wait(Promise.race([engine.exec(args), new Promise((_, reject) => {
        timer = setInterval(() => { if (performance.now() - lastActivity > 30000) { resetWasm(); reject(new Error('FFmpeg 超过 30 秒无响应，请重试或降低样片尺寸。')); } }, 2000);
      })]));
    } finally { clearInterval(timer); engine.off('log', poke); engine.off('progress', poke); }
  }
  async function processWasm(file, index, total) {
    const engine = await loadWasm();
    const inputName = `input_${index}.${file.name.split('.').pop().replace(/[^a-z0-9]/gi, '') || 'mp4'}`;
    const outputName = `output_${index}.mp4`;
    try {
      report(`准备中 ${index + 1}/${total}：${file.name}（FFmpeg 兼容模式）`);
      const data = await run.wait(file.readBytes ? file.readBytes(run.signal) : fetchFile(file));
      await run.wait(engine.writeFile(inputName, data));
      if (!watermarkCached) {
        const image = await run.wait(fetchFile(settings.watermarkUrl));
        await run.wait(engine.writeFile('watermark.png', image)); watermarkCached = true;
      }
      const transcode = async audio => {
        report(`处理中 ${index + 1}/${total}：${file.name}（FFmpeg · ${settings.size === '720' ? '720p 快速样片' : '原尺寸'} · ${audio === 'copy' ? '音频直拷' : 'AAC 音频'}）`);
        return execute(engine, ffmpegArgs(inputName, outputName, { ...settings, audio }));
      };
      let code = await transcode(settings.audio === 'aac' ? 'aac' : 'copy');
      run.check();
      // Codec incompatibility can retry in the same filesystem; no second 267 MB input copy.
      if (code !== 0 && settings.audio !== 'aac') code = await transcode('aac');
      if (code !== 0) throw new Error(`FFmpeg 处理失败（退出码 ${code}）。`);
      const result = await run.wait(engine.readFile(outputName));
      run.check(); publish(new Blob([result], { type: 'video/mp4' }), `${file.name.replace(/\.[^.]+$/, '')}样片.mp4`);
    } finally {
      if (engine.loaded && !run.signal.aborted) await run.wait(Promise.allSettled([engine.deleteFile(inputName), engine.deleteFile(outputName)]));
    }
  }
  async function processWebAV(file, index, total) {
    const cleanups = [];
    function own(resource, cleanup = value => value.destroy()) {
      let released = false;
      const release = () => { if (!released) { released = true; cleanup(resource); } };
      const detach = run.own(release); cleanups.push(() => { detach(); release(); });
      run.check(); return resource;
    }
    let watchdog, outputActive = false;
    try {
      report(`准备中 ${index + 1}/${total}：${file.name}（WebAV 加速）`);
      const source = await run.wait(file.stream(run.signal));
      const mp4 = own(new MP4Clip(source));
      await timeout(mp4.ready, 30000, 'WebAV 读取视频超时。');
      const dimensions = outputDimensions(mp4.meta.width, mp4.meta.height, settings.size);
      const bitrate = Math.round(({ '18': 12e6, '23': 5e6, '28': 2e6 }[settings.crf] || 5e6) * dimensions.width * dimensions.height / (1920 * 1080));
      const options = { ...dimensions, videoCodec: 'avc1.42E032', bitrate };
      if (settings.hardware === 'prefer-hardware') {
        const preference = await timeout((deps.hardwarePreference || hardwarePreference)(options), 10000, '浏览器硬件编码检测超时。');
        if (preference === 'prefer-hardware') options.__unsafe_hardwareAcceleration__ = preference;
        log(preference === 'prefer-hardware' ? '浏览器接受硬件优先编码请求；实际 GPU 使用由驱动和视频格式决定。' : '浏览器未报告支持硬件优先编码，使用浏览器可用的编解码路径。');
        report(preference === 'prefer-hardware' ? '浏览器硬件优先编码已请求，正在准备视频…' : '浏览器硬件优先编码不可用，继续使用兼容编解码…');
      }
      if (!await timeout(Combinator.isSupported(options), 10000, 'WebAV 能力检测超时。')) throw new Error('当前设备不支持此尺寸的 H.264 WebAV 编码。');
      const response = await timeout(fetcher(settings.watermarkUrl, { signal: run.signal }), 30000, 'WebAV 读取水印超时。');
      const imageBlob = await timeout(response.blob(), 30000, 'WebAV 读取水印超时。');
      // Dispose a bitmap even if it finishes decoding after cancellation.
      const image = await run.wait(Promise.resolve(bitmap(imageBlob)).then(value => own(value, item => item.close())));
      const img = own(new ImgClip(image));
      await timeout(img.ready, 30000, 'WebAV 准备水印超时。');
      const videoSprite = own(new OffscreenSprite(mp4)), imageSprite = own(new OffscreenSprite(img));
      for (const sprite of [videoSprite, imageSprite]) { sprite.rect.w = dimensions.width; sprite.rect.h = dimensions.height; sprite.rect.x = 0; sprite.rect.y = 0; }
      const com = own(new Combinator(options));
      await timeout(com.addSprite(videoSprite, { main: true }), 30000, 'WebAV 准备视频图层超时。');
      await timeout(com.addSprite(imageSprite), 30000, 'WebAV 准备水印图层超时。');
      const started = now();
      let lastActivity = started, lastPaint = -Infinity, bestProgress = 0, outputBytes = 0, rejectOutput;
      outputActive = true;
      const paint = () => {
        if (!outputActive || run.signal.aborted) return;
        const current = now();
        if (current - lastPaint < 150) return;
        lastPaint = current;
        const percent = bestProgress >= 1 ? '100' : bestProgress > 0 && bestProgress < 0.01 ? (bestProgress * 100).toFixed(2) : String(Math.floor(bestProgress * 100));
        const stalled = Math.floor((current - lastActivity) / 1000);
        progress(bestProgress * 100);
        report(`处理中 ${index + 1}/${total}：${file.name}（WebAV · ${dimensions.width}×${dimensions.height} · ${percent}% · 已用 ${Math.floor((current - started) / 1000)} 秒${stalled >= 10 ? ` · ${stalled} 秒无推进` : ''}）`);
      };
      const failure = new Promise((_, reject) => { rejectOutput = reject; });
      com.on('error', error => { if (outputActive) rejectOutput(error); });
      com.on('OutputProgress', value => {
        if (!outputActive || run.signal.aborted) return;
        // WebAV emits its current value every 500 ms even when decoding is stuck.
        // Only advancing media progress (including fractions below 1%) resets the deadline.
        if (Number.isFinite(value) && value > bestProgress && value <= 1) { bestProgress = value; lastActivity = now(); }
        paint();
      });
      const reader = own(com.output().getReader(), value => { void value.cancel().catch(() => {}); });
      paint();
      watchdog = setInterval(() => {
        if (!outputActive || run.signal.aborted) return;
        if (now() - lastActivity >= 30000) {
          outputActive = false;
          log(`WebAV 停滞：进度 ${(bestProgress * 100).toFixed(3)}%，已输出 ${outputBytes} 字节，30 秒无实际推进。`);
          rejectOutput(new Error('WebAV 连续 30 秒无实际进度，已停止等待。'));
        } else paint();
      }, 2000);
      const readOutput = async () => {
        const chunks = [];
        while (true) {
          run.check(); const { done, value } = await run.wait(reader.read());
          if (done) break;
          if (value?.byteLength) { outputBytes += value.byteLength; lastActivity = now(); chunks.push(value); }
        }
        return chunks;
      };
      const chunks = await run.wait(Promise.race([readOutput(), failure]));
      run.check(); publish(new Blob(chunks, { type: 'video/mp4' }), `${file.name.replace(/\.[^.]+$/, '')}样片.mp4`);
    } finally {
      outputActive = false;
      clearInterval(watchdog);
      for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch { /* Release remaining resources. */ } }
    }
  }
  return {
    async process(file, index, total) {
      run.check(); progress(0);
      if (preferWebAV(settings.engine, file)) {
        try { await processWebAV(file, index, total); return; }
        catch (error) {
          run.check();
          if (settings.engine !== 'auto') throw error;
          log(`WebAV 不兼容，自动回退 FFmpeg：${error.message}`);
          report('当前视频不兼容 WebAV，正在改用 FFmpeg 继续…'); progress(0);
        }
      }
      await processWasm(file, index, total);
    },
  };
}
