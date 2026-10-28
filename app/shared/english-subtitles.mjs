// English / Spanish require language markers; Chinese has a separate speaker-line mode.
import { normalizeSubtitlePunctuation } from './period-text.mjs';
import { extractChineseSubtitles } from './chinese-subtitles.mjs';
const marker = /^(?:\[(EN|ES(?:[-_](?:ES|MX|LA|419))?|ESP|SPA|SPANISH|ESPAÑOL|西语|西班牙语)\]|【(EN|ES|ESP|SPA|SPANISH|ESPAÑOL|西语|西班牙语)】|\[(EN|ES|ESP|SPA)\s+|(?:西语|西班牙语|Español|Spanish)\s*[:：])/i;
const direction = /^(?:[△▲]|(?:VO|V\.O\.|OS|O\.S\.|SFX|ACTION|SCENE|NOTE|INT\.|EXT\.)\s*[:：])/i;
const titleEnding = /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr)\.$/i;
const spanishTitleEnding = /\b(?:Sr|Sra|Srta|Dr|Dra|Ud|Uds|Prof|Profa)\.$/i;

function dialogueAfterSpeaker(text) {
  // Remove the complete label before stripping Chinese, including bilingual names.
  // An annotation's colon is not the separator; dialogue may contain further colons.
  let annotationDepth = 0;
  for (let at = 0; at < text.length; at++) {
    if ('(（[【'.includes(text[at])) annotationDepth++;
    else if (')）]】'.includes(text[at])) annotationDepth = Math.max(0, annotationDepth - 1);
    else if (!annotationDepth && /[:：]/.test(text[at])) {
      // A marked line without a speaker may contain a time or URL.
      if (/\d/.test(text[at - 1] || '') && /\d/.test(text[at + 1] || '') || text.slice(at + 1, at + 3) === '//') return text;
      return text.slice(at + 1).trimStart();
    }
  }
  return text;
}

export function normalizeEnglish(text, language = 'en') {
  // Drop punctuation belonging to removed Chinese text before normalizing dots.
  return normalizeSubtitlePunctuation(text.replace(/[\p{Script=Han}]+[，、。！？；：,.!?;:]*/gu, ' ')).normalize('NFKC')
    .replace(/\[[^\]]*\]|【[^】]*】|\([^)]*\)/g, ' ')
    .replace(/[\p{Script=Han}]+/gu, ' ')
    .replace(/[“”„]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[，、]/g, ',').replace(/[。…]/g, '.')
    .replace(/！/g, '!').replace(/？/g, '?').replace(/：/g, ':').replace(/；/g, ';')
    .replace(/[—–]/g, ' - ').replace(/\.(?:\s*\.)+/g, '...')
    .replace(/\b(?:V\.?O\.?|O\.?S\.?)\s*:\s*/gi, '')
    // English loanwords and names can contain accented Latin letters (fiancée, José).
    // Normalize punctuation without deleting those letters or their combining marks.
    .replace(language === 'es' ? /[^\p{Script=Latin}\p{M}\x20-\x7E¿¡\n]/gu : /[^\p{Script=Latin}\p{M}\x20-\x7E\n]/gu, ' ').replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    // Ellipses use three ASCII dots; other repeated sentence punctuation stays normalized.
    .replace(/\.{2,}/g, '...').replace(/[!?]+/g, run => run[0])
    // Leading/trailing dashes can mark interrupted dialogue ("You -").
    .replace(/^[;:\s]+|[;:\s]+$/g, '').trim();
}

function sentenceParts(text, language) {
  const result = []; let start = 0;
  for (let at = 0; at < text.length; at++) {
    if (!/[.!?]/.test(text[at])) continue;
    // Retain title dots without treating them as sentence boundaries.
    if (text[at] === '.' && (titleEnding.test(text.slice(0, at + 1)) || language === 'es' && spanishTitleEnding.test(text.slice(0, at + 1)))) continue;
    if (text[at] === '.' && (/\d/.test(text[at - 1] || '') && /\d/.test(text[at + 1] || '') || /\b(?:St|vs|etc|[A-Z])\.$/.test(text.slice(0, at + 1)))) continue;
    if (language === 'es' && text[at] === '.' && /\b(?:Sr|Sra|Srta|Dr|Dra|Ud|Uds|Srta|Prof|Profa|etc)\.$/i.test(text.slice(0, at + 1))) continue;
    let end = at + 1;
    while (/["')]/.test(text[end] || '') && end < text.length) end++;
    if (end < text.length && !/\s/.test(text[end])) continue;
    if (!/\p{Script=Latin}/u.test(text.slice(start, end))) continue;
    result.push(text.slice(start, end).trim()); start = end; at = end - 1;
  }
  if (text.slice(start).trim()) result.push(text.slice(start).trim());
  return result;
}

export function rhythmLines(text, language = 'en') {
  const lines = [];
  for (let sentence of sentenceParts(normalizeEnglish(text, language), language)) {
    while (sentence.length > 76) {
      const candidates = [];
      for (const match of sentence.matchAll(/\s+/g)) {
        const at = match.index;
        if (at < 25 || at > 76) continue;
        const before = sentence.slice(0, at), after = sentence.slice(at).trimStart();
        if (titleEnding.test(before) || language === 'es' && spanishTitleEnding.test(before)) continue;
        const conjunction = language === 'es' ? /^(?:pero|porque|aunque|mientras|antes de|después de|hasta que|cuando|donde|si|para que|sin embargo|entonces|y|o)\b/i : /^(?:but|because|although|while|unless|before|after|until|when|where|if|so that|even if|and then|and|or|yet)\b/i;
        const pause = /[,;:]$/.test(before) || conjunction.test(after);
        candidates.push({ at, score: Math.abs(at - 54) - (pause ? 26 : 0) });
      }
      const best = candidates.sort((a, b) => a.score - b.score)[0];
      if (!best) break; // Never cut through a word or a name without a boundary.
      lines.push(sentence.slice(0, best.at).trim()); sentence = sentence.slice(best.at).trim();
    }
    if (/\p{Script=Latin}/u.test(sentence)) lines.push(sentence);
  }
  return lines;
}

export function extractSubtitles(script, selectedLanguage = 'auto') {
  if (selectedLanguage === 'zh') return extractChineseSubtitles(script);
  const utterances = []; let current = null;
  for (const [index, raw] of script.split('\n').entries()) {
    let text = raw.trim();
    const unlisted = text.replace(/^[-*]\s+/, '');
    // A list prefix before [EN]/[ES] is formatting; a dialogue continuation's dash is text.
    if (marker.test(unlisted)) text = unlisted;
    const marked = text.match(marker);
    if (marked) {
      const language = (marked[1] || marked[2] || marked[3] || 'ES').toUpperCase() === 'EN' ? 'en' : 'es';
      if (selectedLanguage !== 'auto' && selectedLanguage !== language) { current = null; continue; }
      const outer = !!marked[3];
      text = text.slice(marked[0].length).trim();
      if (outer) text = text.replace(/\]\s*$/, '');
      if (/^[△▲]/.test(text)) { current = null; continue; }
      text = dialogueAfterSpeaker(text);
      current = { sourceLine: index + 1, language, text }; utterances.push(current);
    } else if (current && text && !direction.test(text) && !/[\p{Script=Han}△▲]|^\[|^【/u.test(text) && !/^[\p{Lu}][\p{Lu} _.'()-]{0,70}[:：]/u.test(text)) {
      current.text += ' ' + text;
    } else current = null;
  }
  return utterances.flatMap(item => rhythmLines(item.text, item.language).map(text => ({ sourceLine: item.sourceLine, language: item.language, speaker: '', kind: 'dialogue', text })))
    .map((line, index) => ({ id: `line-${index + 1}`, ...line }));
}

export function extractEnglish(script) { return extractSubtitles(script, 'en'); }
