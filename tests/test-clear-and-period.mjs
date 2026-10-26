import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, clearCurrentProject } from '../app/shared/script-projects.mjs';
import { normalizeSubtitlePunctuation } from '../app/shared/period-text.mjs';
test('clearing current content preserves other projects, history and configuration', () => {
  const first = newProject({ script: '[EN] A: Hello.', hint: 'piano', customKeywords: '钢琴,温暖', geminiKey: 'g', sunoKey: 's', durationSeconds: 120, sourceMode: 'suno' });
  first.recommendation = { script: first.draft.script, value: { matches: [{title:'Music'}] } };
  const second = newProject({script:'[EN] B: Stay.'});
  const state = { projects: [first, second], activeId: first.id, history: [{id:'history'}] };
  const cleared = clearCurrentProject(state);
  assert.equal(cleared.projects.length, 2);
  assert.equal(cleared.projects[1], second);
  assert.equal(cleared.history, state.history);
  assert.notEqual(cleared.activeId, first.id, 'in-flight results must retain the previous project identity');
  assert.deepEqual(cleared.projects[0].draft, {...first.draft,script:'',hint:'',customKeywords:'',title:'未填写剧本'});
  assert.equal(cleared.projects[0].recommendation, null);
  assert.equal(state.projects[0].draft.script, '[EN] A: Hello.');
  assert.equal(JSON.parse(JSON.stringify(cleared)).projects[0].draft.script, '');
});
test('copy punctuation uses ASCII dots and commas, preserves line breaks and three-dot ellipses', () => {
  const source = 'Wait ... hello , world .\nHello‚ world․ Done﹒ Yes﹐ 3.5. Really?!';
  const copied = normalizeSubtitlePunctuation(source);
  assert.equal(copied, 'Wait... hello, world.\nHello, world. Done. Yes, 3.5. Really?!');
  assert.doesNotMatch(copied, /[^\x00-\x7F]/);
  assert.equal(normalizeSubtitlePunctuation(copied), copied);
});
