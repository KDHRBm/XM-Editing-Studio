export const CUSTOM_KEYWORDS_LIMIT = 1000;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const normalized = text => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

export function parseCustomKeywords(value = '') {
  if (value == null) return [];
  if (typeof value !== 'string') fail('自定义检索关键词格式无效。');
  if (value.length > CUSTOM_KEYWORDS_LIMIT) fail('自定义检索关键词最多 1000 字符。');
  const seen = new Set(), words = [];
  for (const part of value.split(/[,，、;；\r\n]+/)) {
    const word = part.trim(), key = normalized(word);
    if (!key) continue;
    if (word.length > 60) fail('每个检索关键词或短语最多 60 字符，请用逗号分隔。');
    if (!seen.has(key)) { seen.add(key); words.push(word); }
  }
  if (words.length > 20) fail('最多填写 20 个检索关键词。');
  return words;
}

export function searchMusicTitles(tracks, keywords) {
  if (!keywords.length) return [];
  const terms = keywords.map(word => ({ word, key: normalized(word) })).filter(term => term.key);
  return tracks.map((track, index) => {
    const title = normalized(track.title);
    const matched = terms.filter(({ key }) => /\p{Script=Han}/u.test(key) ? title.includes(key) : ` ${title} `.includes(` ${key} `));
    return { track, index, keywords: matched.map(term => term.word), score: matched.reduce((sum, term) => sum + Math.min(term.key.length, 60), 0) };
  }).filter(item => item.keywords.length).sort((a, b) => b.keywords.length - a.keywords.length || b.score - a.score || a.index - b.index);
}

export function sameLibraryRequest(left, right) {
  return !!left && !!right && left.script === right.script && (left.hint || '') === (right.hint || '') && (left.customKeywords || '').trim() === (right.customKeywords || '').trim() && !!left.segmented === !!right.segmented && (!left.segmented || Number(left.segmentCount || 3) === Number(right.segmentCount || 3));
}
