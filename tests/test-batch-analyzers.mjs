import test from 'node:test';
import assert from 'node:assert/strict';
import { batchAnalyzers } from '../app/src/BatchAnalysisStore.mjs';
import { webAnalyzer } from '../app/shared/script-analyzers.mjs';

test('batch analysis offers every official web provider and keeps Gemini connections', () => {
  const models = batchAnalyzers([{ id: 'gemini', name: 'Gemini', protocol: 'gemini', apiKey: 'test', models: ['gemini-2.5-pro'] }]);
  assert.deepEqual(models.slice(0, 2).map(item => item.provider.webId), ['deepseek', 'doubao']);
  assert.equal(webAnalyzer(models[1])?.model, '豆包');
  assert.equal(models[2].model, '千问');
  assert.equal(models[3].model, 'Kimi');
  assert.equal(webAnalyzer(models[3])?.provider.webId, 'kimi');
  assert.equal(models[4].model, 'gemini-2.5-pro');
});
