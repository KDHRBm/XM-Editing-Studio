import { normalizeSubtitlePunctuation } from './period-text.mjs';

const chineseMarker = /^(?:\[(?:ZH(?:[-_](?:CN|TW|HANS|HANT))?|CN|CHINESE|中文)\]|【(?:ZH|CN|CHINESE|中文)】)\s*/i;
const metadata = /^(?:第.{1,12}[集幕场]|场景|场次|场口|地点|时间|人物|出场(?:人物)?|角色(?:表|介绍)|剧本(?:标题)?|标题|集数|内景|外景|日内|日外|夜内|夜外|动作(?:描写)?|心理(?:描写)?|说明|备注|字幕|屏幕|画面|特写|镜头|音效|背景音乐|转场|旁白说明|VO|V\.?O\.?|OS|O\.?S\.?|SFX|ACTION|SCENE|NOTE|INT\.|EXT\.)$/i;

function speakerSeparator(text) {
  let depth = 0;
  for (let at = 0; at < text.length; at++) {
    if ('(（[【'.includes(text[at])) depth++;
    else if (')）]】'.includes(text[at])) depth = Math.max(0, depth - 1);
    else if (!depth && /[:：]/.test(text[at])) return at;
  }
  return -1;
}

function cleanDialogue(text) {
  return normalizeSubtitlePunctuation(text)
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g, '')
    .replace(/^[\s:：]*(?:(?:V\.?O\.?|O\.?S\.?)\s*[:：]\s*)+/i, '')
    .replace(/[！？]/g, value => value === '！' ? '!' : '?')
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// 中文字幕只交给剪映做配音/字幕识别时，不保留任何标点。
// 在断句之后调用，避免先删掉句号、问号导致相邻句子黏在一起。
export function stripChineseSubtitlePunctuation(text = '') {
  return String(text)
    .replace(/[\p{P}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function chineseRhythm(text) {
  // Chinese sentences have no spaces between them. Preserve decimals and ellipses.
  const sentences = []; let start = 0;
  for (let at = 0; at < text.length; at++) {
    if (!/[.!?]/.test(text[at])) continue;
    if (text[at] === '.' && /\d/.test(text[at - 1] || '') && /\d/.test(text[at + 1] || '')) continue;
    let end = at + 1;
    while (end < text.length && /[.!?]/.test(text[end])) end++;
    while (end < text.length && /[”’"」』]/.test(text[end])) end++;
    sentences.push(text.slice(start, end).trim()); start = end; at = end - 1;
  }
  if (text.slice(start).trim()) sentences.push(text.slice(start).trim());
  const lines = [];
  for (let sentence of sentences) {
    while (sentence.length > 36) {
      const pauses = [...sentence.matchAll(/[,，、;；]/g)].map(match => match.index + 1).filter(at => at >= 8 && at <= 36);
      const at = pauses.sort((a, b) => Math.abs(a - 24) - Math.abs(b - 24))[0];
      if (!at) break; // Without a natural pause, keep the phrase intact.
      lines.push(sentence.slice(0, at).trim()); sentence = sentence.slice(at).trim();
    }
    if (sentence) lines.push(sentence);
  }
  return lines.filter(line => /[\p{L}\p{N}]/u.test(line));
}

export function extractChineseSubtitles(script) {
  const lines = [];
  for (const [index, raw] of script.split('\n').entries()) {
    let text = raw.trim().replace(/^[-*]\s+/, '');
    const marked = chineseMarker.test(text);
    if (marked) text = text.replace(chineseMarker, '');
    if (/^[△▲]|^\[|^【/.test(text)) continue;
    const separator = speakerSeparator(text);
    if (separator < 1) continue;
    const speaker = text.slice(0, separator).replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g, '').trim();
    if (!speaker || speaker.length > 60 || metadata.test(speaker) || !/^[\p{L}\p{N}\p{M}\s·•.'’/_—–-]+$/u.test(speaker)) continue;
    // Do not turn unmarked English / Spanish into Chinese subtitle rows.
    const content = text.slice(separator + 1).split(/[△▲]/, 1)[0];
    if (!marked && !/\p{Script=Han}/u.test(speaker + content)) continue;
    for (const dialogue of chineseRhythm(cleanDialogue(content))) {
      const text = stripChineseSubtitlePunctuation(dialogue);
      if (!text) continue;
      lines.push({ id: `line-${lines.length + 1}`, sourceLine: index + 1, language: 'zh', speaker: '', kind: 'dialogue', text });
    }
  }
  return lines;
}
