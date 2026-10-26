import test from 'node:test';
import assert from 'node:assert/strict';
import { createPunctuationClipboard, restoreProtectedPunctuation } from '../app/electron/period-clipboard.mjs';
const turn = () => new Promise(resolve => setImmediate(resolve));
function modernClipboard() {
  let text = '', formats = ['text/plain'], tick, writes = 0;
  const clipboard = {
    async readText() { await turn(); return text; },
    async writeText(value) { await turn(); text = value; formats = ['text/plain']; writes++; },
    async read() { await turn(); return [{ types: formats }]; },
  };
  const guard = createPunctuationClipboard({ clipboard, schedule: fn => { tick = fn; return 1; }, cancel: () => { tick = undefined; }, retryDelay: turn });
  return { guard, clipboard, tick: () => tick?.(), get text() { return text; }, set text(value) { text = value; }, set formats(value) { formats = value; }, get writes() { return writes; } };
}

test('Electron 44 Promise clipboard preserves all 1500 lines, punctuation and accents after awaited readback', async () => {
  const f = modernClipboard();
  await f.guard.configure(true);
  const original = Array.from({ length: 1500 }, (_, n) => `Line ${n + 1}, señor. 中文，继续...`).join('\n');
  const result = await f.guard.copy(original);
  assert.equal(result.copyVerified, true);
  assert.equal(result.copiedLines, 1500);
  assert.equal(result.clipboardProtected, true);
  assert.equal(restoreProtectedPunctuation(f.text).replace(/\r\n/g, '\n'), original.replaceAll('，', ','));
  assert.doesNotMatch(f.text, /\[object Promise\]/);
  assert.equal(f.guard.status().clipboardError, '');
  await f.guard.dispose();
});

test('async polling protects text and preserves ClipboardItem images and Explorer file copies', async () => {
  const f = modernClipboard();
  f.text = 'One, two.';
  await f.guard.configure(true);
  assert.equal(f.text, 'One‚ two․');
  f.text = 'New, text.'; await f.tick();
  assert.equal(f.text, 'New‚ text․');
  for (const format of ['image/png', 'text/uri-list', 'electron application/osclipboard;format="CF_HDROP"']) {
    f.formats = ['text/plain', format];
    f.text = 'File, description.';
    const writes = f.writes;
    await f.tick(); assert.equal(f.writes, writes);
  }
  await f.guard.dispose(); assert.equal(f.text, 'File, description.');
});

test('async plain JSON copy bypasses subtitle sentinel without changing its mode', async () => {
  const f = modernClipboard(); await f.guard.configure(true);
  const text = '{"script":"Yes, go.","keywords":["a","b"]}';
  await f.guard.copyPlain(text); await f.tick();
  assert.equal(f.text, text); assert.deepEqual(JSON.parse(f.text).keywords, ['a', 'b']);
  assert.equal(f.guard.status().clipboardProtected, true);
  await f.guard.dispose(); assert.equal(f.text, text);
});

test('serialized copies reject a superseded write without letting it overwrite the newer request', async () => {
  const f = modernClipboard();
  let release, started;
  const starting = new Promise(resolve => { started = resolve; });
  const originalWrite = f.clipboard.writeText;
  f.clipboard.writeText = async value => {
    if (value === 'Old.') { started(); await new Promise(resolve => { release = resolve; }); }
    return originalWrite(value);
  };
  const old = f.guard.copy('Old.');
  const rejected = assert.rejects(old, /设置已变化/);
  await starting;
  const next = f.guard.copy('New, complete.', { protect: true });
  release(); await rejected; await next;
  assert.equal(f.text, 'New‚ complete․');
  assert.equal(f.guard.status().clipboardError, '');
});

test('async write rejection is retried; persistent failure never reports successful verification', async () => {
  const f = modernClipboard(); let calls = 0;
  const originalWrite = f.clipboard.writeText;
  f.clipboard.writeText = async text => { if (++calls < 3) throw new Error('busy'); return originalWrite(text); };
  assert.equal((await f.guard.copy('Complete.')).copyVerified, true); assert.equal(calls, 3);
  f.clipboard.writeText = async () => { throw new Error('busy'); };
  await assert.rejects(f.guard.copy('Must not claim success.'), /完整性校验/);
  assert.equal(f.text, 'Complete.');
});

test('disabling while polling is reading cancels old protection; repeated disabled status leaves a batch copy intact', async () => {
  const f = modernClipboard(); await f.guard.configure(true);
  f.text = 'Keep, ASCII.';
  const reading = f.tick(); const disabled = f.guard.configure(false);
  await Promise.all([reading, disabled]); assert.equal(f.text, 'Keep, ASCII.');
  const copy = f.guard.copy('Batch, complete.', { protect: true });
  await f.guard.configure(false); await copy;
  assert.equal(f.text, 'Batch‚ complete․');
});
