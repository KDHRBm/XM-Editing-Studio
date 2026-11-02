import test from 'node:test';
import assert from 'node:assert/strict';
import {splitScript} from '../app/shared/script-score.mjs';
import {batchSubtitleLines} from '../app/shared/batch-analysis.mjs';
const texts=lines=>lines.map(line=>line.text);
const source=`第四十二集
42-1，日，内，包厢
人物：维克多、卡洛琳、克蕾尔、杰瑞、荷官
△包厢内，杰瑞慌张跑进汇报。
杰瑞（急促）：先生！外面的保镖被卡洛琳带的人全打垮了！
Gerardo: Señor, los hombres de Carolina han reducido a todos los guardias
de fuera.
维克多（暴怒）：一群废物！做掉她们！
Víctor: ¡Inútiles! Acabad con ellas.
△十几名保镖扑向卡洛琳。
杰瑞（惶恐）：莫雷洛先生！冷静啊！
Gerardo: Si dispara dentro del casino, vendrá la policía.
维克多（癫狂）：警察？老子现在连命都没了。
Víctor: ¿La policía? Ahora estoy luchando por mi vida. Me importa una mierda
la policía.
Clara: ¡Jefa, cuidado!
Víctor: ¿Cómo has conseguido el percutor de mi pistola?`;
const expected='Señor, los hombres de Carolina han reducido a todos los guardias de fuera. ¡Inútiles! Acabad con ellas. Si dispara dentro del casino, vendrá la policía. ¿La policía? Ahora estoy luchando por mi vida. Me importa una mierda la policía. ¡Jefa, cuidado! ¿Cómo has conseguido el percutor de mi pistola?';
for(const selected of ['auto','es'])test(`unmarked Spanish screenshot retains every dialogue and wrapped line in ${selected}`,()=>{
  for(const script of [source,source.replaceAll('Gerardo:','[ES] Gerardo:')]){
    const lines=splitScript(script,selected);
    assert.equal(texts(lines).join(' '),expected);
    assert(lines.every(line=>line.language==='es'&&!/[\p{Script=Han}]/u.test(line.text)));
    assert.deepEqual(batchSubtitleLines({script,settings:{subtitleLanguage:selected}}),lines);
    assert(lines.some(line=>line.sourceLine===6));
  }
});
test('Spanish fragments do not require episode headings and explicit selection accepts neutral sentences',()=>{
  const fragment='Gerardo: Señor, espere.\nVíctor: ¡No!\nClara: Basta.';
  assert.deepEqual(texts(splitScript(fragment)),['Señor, espere.','¡No!','Basta.']);
  assert.deepEqual(texts(splitScript('Clara: Basta.','es')),['Basta.']);
  assert.deepEqual(splitScript('Clara: Basta.'),[]);
});
test('mixed marked English remains strict and a title-case speaker is never appended to the previous subtitle',()=>{
  assert.deepEqual(texts(splitScript('[EN] Jack: Wait.\nGerardo: Señor, espere.\n[ES] Ana: ¡Sí!')),['Wait.','¡Sí!']);
  assert.deepEqual(splitScript(source,'en'),[]);
  assert.deepEqual(splitScript('人物：Gerardo、Víctor\nLocation: A room.\nhttps://example.com'),[]);
});
