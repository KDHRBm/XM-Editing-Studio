import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebAnalysis } from '../app/electron/web-ai-analysis.mjs';
import { batchAnalyzers } from '../app/src/BatchAnalysisStore.mjs';
import { analysisReady, webAnalyzer } from '../app/shared/script-analyzers.mjs';

test('Kimi is available for script analysis without an API connection', () => {
  const model = batchAnalyzers([]).find(item => item.provider.webId === 'kimi');
  assert.equal(model.label, 'Kimi 官方网页版 · 无需配置');
  assert.equal(analysisReady(model), true);
  assert.equal(webAnalyzer(model).provider.baseUrl, 'https://www.kimi.com/');
});

for (const purpose of ['library-match', 'batch-library-match']) {
  test(`Kimi imports script analysis and validated local music for ${purpose}`, async () => {
    const tracks = Array.from({ length: 5 }, (_, n) => ({ id: `warm-${n + 1}`, title: `温暖钢琴${n + 1}` }));
    let time = 0, step = 0;
    const copied = [], imported = new Set();
    const analysis = { summary: '林夏和陈默在雨夜重逢，误会化解后相互理解。', keywords: ['温暖', '钢琴'] };
    const batch = purpose === 'batch-library-match';
    const host = createWebAnalysis({
      uuid: () => `kimi-step-${++step}`, now: () => time, notify: () => {}, copy: async prompt => copied.push(prompt),
      driver: { visible: () => true, run: () => { throw new Error('Manual Kimi tasks must not operate the webpage'); } },
      delay: async ms => {
        time += ms;
        const task = host.snapshot();
        if (!task || imported.has(task.token)) return;
        imported.add(task.token);
        assert.equal(task.manualOnly, true);
        assert.equal(task.requiresPaste, true);
        assert.match(task.message, /Kimi/);
        await host.action('kimi-request-123', 'copy');
        assert.equal(copied.at(-1), task.prompt);
        await assert.rejects(host.action('kimi-request-123', 'import', JSON.stringify({ xmTaskId: 'another-task', result: analysis })), /完整 JSON/);
        const matches = tracks.map((track, n) => ({ [batch ? 'ref' : 'id']: batch ? `M${n + 1}` : track.id, reason: '温暖钢琴呼应雨夜重逢后化解误会的情绪。', keywords: ['温暖'] }));
        const value = step === 1 ? analysis : { matches, noMatchReason: '' };
        await host.action('kimi-request-123', 'import', JSON.stringify({ xmTaskId: task.token, result: batch ? { episodes: [{ id: 'episode-1', ...value }] } : value }));
      },
    });
    const input = batch ? { episodes: [{ id: 'episode-1', episodeNumber: 1, script: '林夏和陈默在雨夜重逢，误会化解。' }], tracks } : { script: '林夏和陈默在雨夜重逢，误会化解。', tracks };
    const result = await host.run({ id: 'kimi-request-123', provider: 'kimi', purpose, input });
    const value = batch ? result.episodes[0].value : result;
    assert.equal(value.analysis.summary, analysis.summary);
    assert.deepEqual(value.matches.map(item => item.id), tracks.map(item => item.id));
    assert.equal(imported.size, 2);
    assert.equal(host.snapshot(), null);
  });
}
