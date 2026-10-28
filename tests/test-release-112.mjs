import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScript, materialTexts } from '../app/shared/script-score.mjs';
import { createScriptQueue } from '../app/shared/script-queue.mjs';
import { scriptMusicHistory } from '../app/shared/script-music-history.mjs';
import { score } from './script-test-fixtures.mjs';
const input = { script: '[ES] JOSÉ: ¡Hola!', durationSeconds: 90, subtitleLanguage: 'es' };
const provider = { providerId: 'p', baseUrl: 'http://mock', protocol: 'suno', model: 'suno-test' };
function harness(options = {}) {
  const history = new Map(), calls = []; let id = 0;
  const q = createScriptQueue({ save: () => {}, getProvider: () => ({ ...provider, apiKey: 'test-only' }), uuid: () => String(++id),
    request: async (url, body) => { calls.push(url); if (url.endsWith('/score')) return { score }; if (url.endsWith('/generate')) return { tracks: [{ id: 'task', taskId: 'task', status: 'pending' }] }; return { tracks: [{ id: 'clip', taskId: 'task', status: 'complete', audioUrl: 'https://example.com/test.mp3' }] }; },
    onComplete: j => history.set(j.id, scriptMusicHistory(j)), onArchive: j => history.set(j.id, scriptMusicHistory(j)), exportMaterials: async () => ({ ok: true, path: 'saved.mp3' }), ...options });
  return { q, history, calls, add: directory => q.add(input, provider, provider, directory) };
}
test('mixed English and Spanish extraction preserves accents, punctuation, order and language filter', () => {
  const script = `[EN] JACK: Mr. Harris... wait.\n[ES] JOSÉ: ¿Dónde está el niño? ¡Qué vergüenza!\n[ZH] 他在哪里？\n▲ SALA: direction\n[ES-MX] MARÍA: Sr. Pérez, son las 10:30. Cuesta 3.5 euros...\n[FR] JO: Bonjour.\n[ES] ÁLVARO (VO): (susurra) Mañana iré.\nSpanish: LUCÍA: Sí, después.\n普通中文。`;
  const lines = splitScript(script);
  assert.deepEqual(lines.map(l => l.text), ['Mr. Harris...', 'wait.', '¿Dónde está el niño?', '¡Qué vergüenza!', 'Sr. Pérez, son las 10:30.', 'Cuesta 3.5 euros...', 'Mañana iré.', 'Sí, después.']);
  assert.equal(splitScript(script, 'en').length, 2); assert.equal(splitScript(script, 'es').length, 6);
  assert.ok(splitScript(script, 'es').every(l => l.language === 'es'));
  assert.deepEqual(splitScript('JOSÉ: Esta línea no está marcada.'), []);
  assert.throws(() => splitScript(script, 'fr'), /语言/);
});
test('long Spanish wraps naturally and exports verbatim accents with ASCII dots', () => {
  const text = 'Sé que llevas mucho tiempo esperando aquí en la estación, pero todavía necesito hablar contigo antes de que te marches para siempre.';
  const lines = splitScript('[ES] MARÍA: ' + text);
  assert.equal(lines.map(l => l.text).join(' '), text); assert.ok(lines.every(l => l.text.length <= 76));
  const files = materialTexts({ ...input, lines, source: 'library', localTrack: { title: 'song' }, analysis: { summary: '', keywords: [] } });
  assert.equal(files['逐行台词.txt'], lines.map(l => l.text).join('\n'));
});
test('clear removes queued/planning tasks and late planning cannot resurrect or submit them', async () => {
  let resolve;
  const h = harness({ request: () => new Promise(r => { resolve = r; }) }); h.add(); h.add(); h.q.start();
  const running = h.q.tick(); h.q.clear(); assert.equal(h.q.snapshot().running, false); assert.equal(h.q.snapshot().jobs.length, 0);
  resolve({ score }); await running; await h.q.tick(); assert.equal(h.q.snapshot().jobs.length, 0);
});
test('clear completed tasks keeps durable music history and finishes autosave before detaching', async () => {
  const h = harness(); h.add('output'); h.q.start(); await h.q.tick(); await h.q.tick(); await h.q.tick();
  h.q.clear(); assert.ok(h.q.snapshot().jobs.every(j => j.archived)); assert.equal(h.history.get('1').status, 'complete');
  await h.q.tick(); await h.q.tick(); assert.equal(h.q.snapshot().jobs.length, 0);
  assert.equal(h.history.get('1').exportPath, 'saved.mp3'); assert.equal(h.history.get('1').queueManaged, false);
  assert.equal(h.calls.filter(c => c.endsWith('/generate')).length, 1);
});
test('clearing an in-flight paid submission keeps its IDs and completes in history without resubmission', async () => {
  let resolve, submissions = 0;
  const h = harness({ request: async url => {
    if (url.endsWith('/score')) return { score };
    if (url.endsWith('/generate')) { submissions++; return new Promise(r => { resolve = r; }); }
    return { tracks: [{ id: 'clip', taskId: 'paid', status: 'complete', audioUrl: 'https://example.com/music.mp3' }] };
  } });
  h.add(); h.q.start(); await h.q.tick(); const pending = h.q.tick(); h.q.clear();
  assert.equal(h.history.get('1').status, 'submitting');
  resolve({ tracks: [{ id: 'paid', taskId: 'paid', status: 'pending' }] }); await pending;
  assert.deepEqual(h.q.snapshot().jobs[0].taskIds, ['paid']); assert.equal(h.q.snapshot().jobs[0].archived, true);
  await h.q.tick(); assert.equal(h.history.get('1').status, 'complete'); await h.q.tick(); assert.equal(h.q.snapshot().jobs.length, 0); assert.equal(submissions, 1);
});
test('history storage failure leaves completed queue visible', async () => {
  const h = harness({ onArchive: () => { throw new Error('disk full'); } }); h.add(); h.q.start(); await h.q.tick(); await h.q.tick(); await h.q.tick();
  assert.throws(h.q.clear, /disk full/); assert.equal(h.q.snapshot().jobs.length, 1); assert.ok(!h.q.snapshot().jobs[0].archived);
});
test('archived interrupted submissions recover by ID, never block or resubmit new visible tasks', async () => {
  const h = harness(); h.add(); const raw = h.q.snapshot().jobs[0];
  const restored = harness({ initial: [{ ...raw, status: 'submitting', archived: true, score }] });
  assert.equal(restored.q.snapshot().jobs[0].status, 'uncertain'); restored.q.start(); await restored.q.tick(); assert.equal(restored.calls.length, 0);
  restored.q.recover(raw.id, 'original'); await restored.q.tick(); assert.equal(restored.calls[0], '/api/music/query');
  assert.equal(restored.history.get(raw.id).status, 'complete');
});
