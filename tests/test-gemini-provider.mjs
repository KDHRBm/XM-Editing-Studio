import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../app/shared/api-service.mjs';

const provider = { protocol: 'gemini', baseUrl: '', apiKey: 'fixture-secret' };

test('Gemini AI Studio lists eligible models with pagination and no key in the URL', async () => {
  const calls = [];
  const api = createApiService(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json(calls.length === 1
      ? { models: [{ name: 'models/gemini-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next' }
      : { models: [{ name: 'models/gemini-pro', supportedGenerationMethods: ['generateContent'] }] });
  });
  const result = await api('/api/providers/models', { provider });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.models, ['gemini-flash', 'gemini-pro']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.origin, 'https://generativelanguage.googleapis.com');
  assert.equal(calls[0].url.pathname, '/v1beta/models');
  assert.equal(calls[1].url.searchParams.get('pageToken'), 'next');
  for (const call of calls) {
    assert.equal(call.options.headers['x-goog-api-key'], provider.apiKey);
    assert.doesNotMatch(call.url.href, /fixture-secret/);
  }
});

test('Gemini AI Studio tests a model without a Base URL', async () => {
  let request;
  const api = createApiService(async (url, options) => {
    request = { url: new URL(url), options };
    return Response.json({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] });
  });
  const result = await api('/api/providers/test', { provider, model: 'gemini-flash' });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.preview, 'OK');
  assert.equal(request.url.pathname, '/v1beta/models/gemini-flash:generateContent');
  assert.equal(request.options.headers['x-goog-api-key'], provider.apiKey);
  assert.doesNotMatch(request.options.body, /fixture-secret/);
});
