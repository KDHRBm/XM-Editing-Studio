import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startLocalService } from '../app/electron/local-service.mjs';

test('occupied backend port keeps renderer origin and forwards ranges, bodies and errors independently', async () => {
  const occupied = createServer((_req, res) => res.end('other installation'));
  await new Promise(r => occupied.listen(0, '127.0.0.1', r));
  const port = occupied.address().port, origin = `http://127.0.0.1:${port}`;
  let handler, unhandled = false;
  const protocol = { handle: (scheme, callback) => { assert.equal(scheme, 'http'); handler = callback; }, unhandle: () => { unhandled = true; } };
  const make = ({ port, host }) => new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      if (req.headers.range) { res.writeHead(206, { 'content-range': 'bytes 0-3/9' }); res.end('clip'); }
      else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ body, sameOrigin: req.headers.origin === `http://${req.headers.host}` })); }
    });
    server.once('error', reject); server.listen(port, host, () => resolve(server));
  });
  const server = await startLocalService({ createServer: make, options: { host: '127.0.0.1', port }, protocol, externalFetch: async () => new Response('external') });
  try {
    assert.notEqual(server.address().port, port);
    const response = await handler(new Request(origin + '/api/test', { method: 'POST', headers: { Origin: origin }, body: '字幕 Spanish ñ 中文' }));
    assert.deepEqual(await response.json(), { body: '字幕 Spanish ñ 中文', sameOrigin: true });
    const clip = await handler(new Request(origin + '/local-music/a', { headers: { range: 'bytes=0-3' } }));
    assert.equal(clip.status, 206); assert.equal(await clip.text(), 'clip');
    assert.equal(await (await handler(new Request('http://example.com/'))).text(), 'external');
    assert.equal(await (await fetch(origin)).text(), 'other installation');
  } finally { await Promise.all([new Promise(r => server.close(r)), new Promise(r => occupied.close(r))]); }
  assert.equal(unhandled, true);
});

test('non-conflict startup errors are not hidden by port fallback', async () => {
  await assert.rejects(startLocalService({ createServer: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }, options: {} }), /denied/);
});
