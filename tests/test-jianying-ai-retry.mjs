import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJianyingAI } from '../app/electron/jianying-ai.mjs';

const connection = { provider: { protocol: 'gemini', baseUrl: 'https://example.invalid/v1beta', apiKey: 'fixture-secret' }, model: 'gemini-fixture' };
const success = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"heading":null}' }] } }] }));
const input = { prompt: 'Find drafts', image: 'YWJj' };

test('transient upstream 500 retries preserve the full image request and report progress', async () => {
  const calls = [], reports = [], waits = [];
  const result = await requestJianyingAI(connection, input, null, async (url, options) => {
    calls.push({ url: String(url), body: options.body, headers: options.headers });
    return calls.length < 3 ? new Response('{"error":{"message":"upstream error: do request failed"}}', { status: 500 }) : success();
  }, { delay: async ms => waits.push(ms), onRetry: message => reports.push(message) });
  assert.equal(result, '{"heading":null}');
  assert.equal(calls.length, 3); assert.deepEqual(calls[1], calls[0]); assert.deepEqual(calls[2], calls[0]);
  assert.deepEqual(waits, [1000, 2000]); assert.match(reports[0], /2\/3/); assert.match(reports[1], /3\/3/);
});

test('text and HTML gateway failures retry at most three times with a useful sanitized error', async () => {
  let attempts = 0;
  await assert.rejects(requestJianyingAI(connection, input, null, async () => {
    attempts++; return new Response('<h1>Bad gateway</h1> fixture-secret', { status: 502 });
  }, { delay: async () => {} }), error => /上游服务异常（502）.*3 次/.test(error.message) && !error.message.includes('fixture-secret') && !error.message.includes('<h1>'));
  assert.equal(attempts, 3);
});

test('invalid credentials, quota limits and malformed success are not retried', async () => {
  for (const status of [400, 401, 403, 429, 200]) {
    let attempts = 0;
    await assert.rejects(requestJianyingAI(connection, input, null, async () => { attempts++; return new Response('not JSON', { status }); }, { delay: async () => assert.fail('must not retry') }));
    assert.equal(attempts, 1);
  }
});

test('network failure may recover but user cancellation stops a pending retry immediately', async () => {
  let attempts = 0;
  assert.equal(await requestJianyingAI(connection, input, null, async () => { if (++attempts === 1) throw new TypeError('fetch failed'); return success(); }, { delay: async () => {} }), '{"heading":null}');
  const controller = new AbortController(); attempts = 0;
  const pending = requestJianyingAI(connection, input, controller.signal, async () => { attempts++; return new Response('upstream error', { status: 500 }); }, { onRetry: () => controller.abort() });
  await assert.rejects(pending, /已中断/); assert.equal(attempts, 1);
});

test('cancel while reading a response cannot return a late result or send another request', async () => {
  const controller = new AbortController(); let attempts = 0;
  await assert.rejects(requestJianyingAI(connection, input, controller.signal, async () => {
    attempts++; return { ok: true, text: async () => { controller.abort(); return await success().text(); } };
  }), /已中断/);
  assert.equal(attempts, 1);
});

test('all retries share one timeout budget shorter than the native worker deadline', async () => {
  let attempts = 0;
  // Keep the process alive because AbortSignal.timeout uses unref'ed timers.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(requestJianyingAI(connection, input, null, async (_url, { signal }) => {
      attempts++; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }, { attemptTimeoutMs: 15, totalTimeoutMs: 40, delay: async () => {} }), /超时/);
    assert.ok(attempts >= 1 && attempts <= 3);
  } finally { clearInterval(keepAlive); }
});
