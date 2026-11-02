// Broaden title retrieval before AI judges semantic suitability. Never synthesize a recommendation.
const families = [
  ['悲伤','伤感','悲痛','忧伤','哀伤','悲凉','失落','悲剧','sad','sadness','sorrow','melancholy','melancholic'],
  ['悬疑','紧张','压迫','诡异','惊悚','暗潮','阴谋','危机','恐惧','suspense','tension','tense','thriller','dark'],
  ['温暖','温柔','温馨','柔和','感动','治愈','亲情','温情','warm','gentle','tender','emotional'],
  ['浪漫','爱情','暧昧','甜蜜','爱意','romance','romantic','love'],
  ['愤怒','激烈','冲突','战斗','复仇','对峙','震撼','燃','action','angry','battle','epic'],
  ['轻松','欢快','开心','搞笑','喜剧','活泼','愉快','happy','playful','comedy','upbeat'],
  ['钢琴','piano'],['弦乐','小提琴','大提琴','strings','violin','cello'],['吉他','guitar'],['鼓','打击乐','drums','percussion'],
  ['电子','合成器','synth','electronic'],['黑帮','黑手党','豪门','mafia','gangster'],
];
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const includes = (text, term) => /\p{Script=Han}/u.test(term) ? text.includes(term) : ` ${text} `.includes(` ${term} `);
const titleFamily = text => normalize(text).replace(/\b\d+\b/g, '').trim();
export function batchCandidates(tracks, keywords, limit = 40) {
  const exact = [...new Set(keywords.map(normalize))];
  const expanded = new Set(exact.flatMap(word => word.split(' ').filter(word => word.length > 1)));
  for (const family of families) if (family.some(term => exact.some(word => includes(word, term)))) for (const term of family) expanded.add(term);
  const scored = tracks.map((track, index) => {
    const title = normalize(track.title);
    const score = exact.reduce((sum, word) => sum + (includes(title, word) ? 30 + Math.min(word.length, 12) : 0), 0)
      + [...expanded].reduce((sum, word) => sum + (includes(title, word) ? 4 : 0), 0);
    return { track, index, score, family: titleFamily(track.title) };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  // A small library can go directly to the model. Larger libraries keep title
  // diversity so numbered copies of one track cannot crowd out other moods.
  const selected = [], used = new Set(), groups = new Map();
  const add = item => { if (!used.has(item.track.id)) { selected.push(item.track); used.add(item.track.id); groups.set(item.family,(groups.get(item.family)||0)+1); } };
  for (const item of scored) if (item.score > 0 && selected.length < limit && (groups.get(item.family)||0) < 2) add(item);
  if (selected.length < limit) {
    const seenFamilies = new Set(groups.keys());
    const diverse = scored.filter(item => { if (used.has(item.track.id) || seenFamilies.has(item.family)) return false; seenFamilies.add(item.family); return true; });
    const slots = Math.min(limit - selected.length, diverse.length);
    for (let index = 0; index < slots; index++) add(diverse[Math.floor(index * diverse.length / slots)]);
  }
  if (tracks.length <= limit) for (const item of scored) add(item);
  // Numbered variants are real local files too. If diversity alone yields fewer
  // than five choices, keep enough candidates for the model to evaluate five.
  for (const item of scored) if (selected.length < Math.min(5, limit)) add(item);
  return selected.map(({id,title}) => ({id,title}));
}
