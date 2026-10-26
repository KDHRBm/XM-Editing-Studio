import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScript, materialTexts } from '../app/shared/script-score.mjs';
import { newProject, rememberProject } from '../app/shared/script-projects.mjs';
import { normalizeSubtitlePunctuation } from '../app/shared/period-text.mjs';
test('strict EN extraction removes roles, directions, Chinese and normalizes titles and punctuation', () => {
  const text = `第3集\n▲ JACK leaves.\nJACK: This must not be extracted.\n[EN] JACK (VO): （低声）“Mr. Harris… wait...”\n[EN] MIA: Ms. Foster, Ms. Wynn and Dr. Green are here！\nVO: An unrelated thought.\n[EN] JACK: (whispering) It's 10:30. I paid 3.5 dollars.`;
  assert.deepEqual(splitScript(text).map(r => r.text), ['"Mr Harris...', 'wait..."', 'Ms Foster, Ms Wynn and Dr Green are here!', "It's 10:30.", 'I paid 3.5 dollars.']);
});
test('subtitle ellipses keep three dots through extraction, copying and material exports', () => {
  const lines = splitScript('[EN] DAISY: Daddy... when are you coming back...').map(row => row.text);
  assert.deepEqual(lines, ['Daddy...', 'when are you coming back...']);
  assert.equal(normalizeSubtitlePunctuation(lines.join('\n')), 'Daddy...\nwhen are you coming back...');
  assert.deepEqual(splitScript('[EN] MIA: ... Please… wait. . . I know......\n[EN] JACK: Mr. Harris paid 3.5 dollars. Really?!').map(row => row.text), ['... Please...', 'wait...', 'I know...', 'Mr Harris paid 3.5 dollars.', 'Really?']);
  assert.deepEqual(splitScript('[EN] MIA: Wait...please.').map(row => row.text), ['Wait...please.']);
  assert.deepEqual(splitScript('[EN] MIA: Wait... 等等。\n[EN] JACK: I know. 我知道。').map(row => row.text), ['Wait...', 'I know.']);
  assert.deepEqual(splitScript('[EN] DAISY: Daddy․․․ when are you coming back﹒\n[EN] MIA: Hello‚ Mr․ Harris.').map(row => row.text), ['Daddy...', 'when are you coming back.', 'Hello, Mr Harris.']);
  const texts = materialTexts({ script:'original', lines:[{kind:'dialogue',text:'Daddy․․․'},{kind:'dialogue',text:'Come back․'}], source:'library', localTrack:{title:'fixture'}, analysis:{summary:'fixture',keywords:[]} });
  assert.equal(texts['逐行台词.txt'], 'Daddy...\nCome back.');
  assert.doesNotMatch(texts['台词清单.csv'], /[․﹒‚﹐…]/);
});
test('long dialogue wraps at a clause boundary without changing words', () => {
  const text = 'I have been waiting outside this house since early morning, because I need to know what happened to my family before I leave this town forever.';
  const lines = splitScript('[EN] JACK: ' + text).map(r => r.text);
  assert.ok(lines.length >= 2); assert.ok(lines.every(l => l.length <= 76)); assert.equal(lines.join(' '), text);
});
test('unmarked dialogue is never included', () => {
  assert.deepEqual(splitScript('JACK: Hello.\nMIA: Goodbye.\nEnglish: Ignore this.'), []);
});
test('history retains only five recent scripts and preserves their own recommendations', () => {
  let history = [];
  for (let n = 0; n < 7; n++) { const p = newProject({script: `[EN] JACK: Script ${n}.`, hint: ''}); const record = {script:p.draft.script,hint:'',value:{analysis:{summary:`story${n}`},matches:[{id:`music${n}`,title:`Piano ${n}`}]}}; history = rememberProject(history,p,record); }
  assert.equal(history.length,5); assert.equal(history[0].recommendation.value.matches[0].id,'music6'); assert.equal(history[4].recommendation.value.matches[0].id,'music2');
  const p = newProject(history[4].draft); history = rememberProject(history,p);
  assert.equal(history.length,5); assert.equal(history[0].recommendation.value.matches[0].id,'music2');
  const restored = JSON.parse(JSON.stringify(history)); assert.equal(restored[0].draft.script,'[EN] JACK: Script 2.');
});
