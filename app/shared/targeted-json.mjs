// Parse a complete answer only. Syntax cleanup never supplies missing data,
// guesses a track ID, or closes a truncated object/array.
function repairEchoedLineQuotes(source) {
  // Flash can echo input evidence as {"line":72",...}. Only remove that
  // stray quote from a bare, nonnegative integer line property. In particular,
  // never coerce quoted numbers or repair ref/id/evidenceLine selection values.
  const line = /("line"\s*:\s*)(0|[1-9]\d*)(\s*)"(?=\s*[,}])/y;
  let output = '', depth = 0, quoted = false, escaped = false, previous = '';
  for (let at = 0; at < source.length; at++) {
    const ch = source[at];
    if (depth && quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '{') depth++;
    else if (depth && ch === '}') depth--;
    else if (depth && ch === '"') {
      if (previous === '{' || previous === ',') {
        line.lastIndex = at;
        const match = line.exec(source);
        if (match) {
          output += match[1] + match[2] + match[3];
          at = line.lastIndex - 1;
          previous = match[2].at(-1);
          continue;
        }
      }
      quoted = true;
    }
    if (!/\s/.test(ch)) previous = ch;
    output += ch;
  }
  return output;
}

export function parseTargetedJson(text) {
  if (typeof text !== 'string' || text.length > 200000) throw new Error('模型返回的 JSON 过长或无效。');
  let source = text.replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error('模型返回空白 JSON，音乐推荐尚未完成。');
  try {
    const value = JSON.parse(source);
    if (typeof value !== 'string') return value;
    source = value.trim(); // Some compatible endpoints encode the JSON twice.
  } catch { /* Try formatting-only repairs below. */ }
  source = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  source = repairEchoedLineQuotes(source);
  // Allow prose around ONE complete object, but reject ambiguous multiple answers.
  let start = -1, depth = 0, quoted = false, escaped = false;
  const objects = [];
  for (let at = 0; at < source.length; at++) {
    const ch = source[at];
    if (start < 0) { if (ch === '{') { start = at; depth = 1; } continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { objects.push(source.slice(start, at + 1)); start = -1; }
  }
  if (start >= 0 || objects.length !== 1) throw new Error('模型 JSON 不完整或包含多个结果，音乐推荐尚未完成。');
  source = objects[0];
  let repaired = ''; quoted = false; escaped = false;
  for (let at = 0; at < source.length; at++) {
    const ch = source[at];
    if (quoted) {
      // Preserve raw line breaks/tabs in values by escaping them, not deleting text.
      if (ch.charCodeAt(0) < 32) {
        if (escaped) throw new Error('模型 JSON 转义不完整，音乐推荐尚未完成。');
        repaired += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
        continue;
      }
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      let next = at + 1;
      while (next < source.length && /\s/.test(source[next])) next++;
      if (source[next] === '}' || source[next] === ']') continue;
    }
    repaired += ch;
  }
  try { return JSON.parse(repaired); }
  catch { throw new Error('模型 JSON 格式无效，音乐推荐尚未完成；可仅补缺项。'); }
}
