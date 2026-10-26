import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessingRun } from '../watermarker/src/processing-run.mjs';
import { createWatermarkProcessors } from '../watermarker/src/processing-engines.mjs';
import { outputDimensions } from '../watermarker/src/video-options.mjs';
const file = { name: '中文样片.mp4', stream: () => new ReadableStream({ start(c) { c.close(); } }) };
const turn = () => new Promise(r => setImmediate(r));
async function until(predicate) { for (let n = 0; n < 50 && !predicate(); n++) await turn(); assert.ok(predicate()); }
function harness(options = {}) {
  const stats = { instances: [], exports: [], writes: [], args: [], destroyed: 0, log: [], statuses: [], options: null, streamCancelled: false, events: {}, output: null };
  class FFmpeg {
    constructor() { stats.instances.push(this); this.loaded = false; }
    async load() { if (options.loading) await options.loading; this.loaded = true; }
    on() {} off() {}
    async writeFile(name) { stats.writes.push(name); }
    async exec(args) { stats.args.push(args); if (options.executing) return options.executing; return options.copyFails && args.includes('copy') ? 1 : 0; }
    async readFile() { return new Uint8Array([1, 2, 3]); } async deleteFile() {}
    terminate() { this.terminated = true; this.loaded = false; }
  }
  class Clip { constructor() { this.ready = Promise.resolve(); this.meta = { width: 1920, height: 1080 }; } destroy() { stats.destroyed++; } }
  class Sprite { rect = {}; destroy() { stats.destroyed++; } }
  class Combinator {
    static async isSupported() { return options.supported !== false; }
    constructor(value) { stats.options = value; }
    async addSprite() {} on(name, callback) { stats.events[name] = callback; } destroy() { stats.destroyed++; }
    output() { return new ReadableStream({ start(c) { stats.output = c; if (!options.pendingStream) { c.enqueue(new Uint8Array([1])); c.close(); } }, cancel() { stats.streamCancelled = true; } }); }
  }
  const run = createProcessingRun();
  const processors = createWatermarkProcessors({ FFmpeg, MP4Clip: Clip, ImgClip: Clip, OffscreenSprite: Sprite, Combinator,
    fetcher: async () => ({ blob: async () => new Blob([]) }), bitmap: async () => ({ close: () => { stats.destroyed++; } }),
    fetchFile: async () => new Uint8Array([1]), publish: (...result) => stats.exports.push(result), status: msg => stats.statuses.push(msg), progress: () => {}, log: msg => stats.log.push(msg), now: options.now,
  }, run, { engine: options.engine || 'ffmpeg', crf: '23', audio: 'auto', size: options.size || 'original', watermarkUrl: 'fixture' });
  return { stats, run, process: () => processors.process(file, 0, 1) };
}
test('cancel during WASM load or encode stops the owned worker, skips audio fallback and emits no partial file', async () => {
  for (const stage of ['loading', 'executing']) {
    const h = harness({ [stage]: new Promise(() => {}) }); const pending = h.process();
    await until(() => stage === 'loading' ? h.stats.instances.length : h.stats.args.length);
    h.run.cancel(); await assert.rejects(pending, { name: 'AbortError' });
    assert.ok(h.stats.instances[0].terminated); assert.equal(h.stats.exports.length, 0); assert.ok(h.stats.args.length <= 1);
  }
  const next = harness(); await next.process(); assert.equal(next.stats.exports.length, 1); next.run.dispose();
});
test('audio fallback reuses input and initialized engine, retains optional audio mapping', async () => {
  const h = harness({ copyFails: true }); await h.process();
  assert.equal(h.stats.instances.length, 1); assert.equal(h.stats.writes.filter(n => n.startsWith('input')).length, 1);
  assert.equal(h.stats.args.length, 2); assert.ok(h.stats.args[1].includes('aac')); assert.ok(h.stats.args[1].includes('0:a?')); assert.equal(h.stats.exports.length, 1); h.run.dispose();
});
test('auto prefers WebAV, preserves original size, and falls back when unsupported', async () => {
  const fast = harness({ engine: 'auto' }); await fast.process(); assert.equal(fast.stats.instances.length, 0); assert.equal(fast.stats.options.width, 1920); assert.equal(fast.stats.exports.length, 1); assert.ok(fast.stats.destroyed >= 5); fast.run.dispose();
  const fallback = harness({ engine: 'auto', supported: false }); await fallback.process(); assert.equal(fallback.stats.instances.length, 1); assert.equal(fallback.stats.exports.length, 1); assert.match(fallback.stats.log[0], /自动回退/); fallback.run.dispose();
});
test('cancel WebAV closes reader/clips and does not silently start FFmpeg', async () => {
  const h = harness({ engine: 'auto', pendingStream: true }); const pending = h.process(); await until(() => !!h.stats.options); await turn();
  h.run.cancel(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(h.stats.instances.length, 0); assert.equal(h.stats.exports.length, 0); assert.ok(h.stats.destroyed >= 5); assert.equal(h.stats.streamCancelled, true);
});
test('720p respects portrait, landscape, aspect ratio and never upscales', async () => {
  assert.deepEqual(outputDimensions(1920, 1080, '720'), { width: 1280, height: 720 });
  assert.deepEqual(outputDimensions(1080, 1920, '720'), { width: 720, height: 1280 });
  assert.deepEqual(outputDimensions(640, 360, '720'), { width: 640, height: 360 });
  assert.deepEqual(outputDimensions(1920, 1080), { width: 1920, height: 1080 });
  const h = harness({ engine: 'webav', size: '720' }); await h.process(); assert.equal(h.stats.options.height, 720); h.run.dispose();
});

test('repeated WebAV heartbeat values cannot prevent timeout, including a stall at 0%', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  for (const plateau of [0, 0.42]) {
    let time = 0;
    const h = harness({ engine: 'auto', pendingStream: true, now: () => time });
    const pending = h.process(); await until(() => !!h.stats.output);
    for (let seconds = 0; seconds < 30; seconds++) {
      h.stats.events.OutputProgress(plateau); time += 1000; t.mock.timers.tick(1000); await turn();
    }
    await pending;
    assert.equal(h.stats.instances.length, 1, 'must switch to FFmpeg');
    assert.equal(h.stats.exports.length, 1, 'only completed fallback output is published');
    assert.equal(h.stats.streamCancelled, true);
    assert.ok(h.stats.log.some(line => /30 秒无实际推进/.test(line)));
    const count = h.stats.statuses.length;
    h.stats.events.OutputProgress(0.9);
    assert.equal(h.stats.statuses.length, count, 'late WebAV events cannot overwrite fallback state');
    h.run.dispose();
  }
});

test('growing fractional progress below 1% and actual output bytes keep healthy work alive', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let time = 0;
  const h = harness({ engine: 'auto', pendingStream: true, now: () => time });
  const pending = h.process(); await until(() => !!h.stats.output);
  for (let n = 1; n <= 6; n++) {
    time += 10000; h.stats.events.OutputProgress(n / 1000); t.mock.timers.tick(10000); await turn();
  }
  assert.equal(h.stats.instances.length, 0);
  assert.ok(h.stats.statuses.some(line => /0\.60%/.test(line)));
  for (let n = 0; n < 4; n++) {
    time += 10000; h.stats.output.enqueue(new Uint8Array([1])); await turn(); t.mock.timers.tick(10000); await turn();
  }
  assert.equal(h.stats.instances.length, 0);
  h.stats.output.close(); await pending;
  assert.equal(h.stats.exports.length, 1); h.run.dispose();
});

test('explicit WebAV mode reports a stalled job without silently changing engines', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let time = 0;
  const h = harness({ engine: 'webav', pendingStream: true, now: () => time });
  const pending = h.process(); const rejected = assert.rejects(pending, /30 秒无实际进度/);
  await until(() => !!h.stats.output);
  h.stats.events.OutputProgress(0); time = 30000; t.mock.timers.tick(30000);
  await rejected;
  assert.equal(h.stats.instances.length, 0); assert.equal(h.stats.exports.length, 0); assert.equal(h.stats.streamCancelled, true); h.run.dispose();
});
