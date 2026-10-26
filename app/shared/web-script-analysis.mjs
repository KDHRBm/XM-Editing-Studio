import { validateScoreRequest, scoreMessages, parseScoreResponse } from './script-score.mjs';
import { validateLibraryInput, keywordMessages, parseKeywords, shortlistTracks, matchMessages, parseMatches } from './library-match.mjs';
import { segmentMessages, parseSegments, segmentCandidates, segmentMatchMessages, parseSegmentMatches } from './script-segments.mjs';

// Reuse the same validators as the API workflow; a webpage answer is always untrusted data.
export async function analyzeWithWeb(purpose, body, ask) {
  if (purpose === 'score') {
    const input = validateScoreRequest(body);
    if (input.segmented) return { segments: parseSegments(await ask(segmentMessages(input, 'suno'), '分情节编写音乐提示词'), input, 'suno') };
    return { score: parseScoreResponse(await ask(scoreMessages(input), '编写音乐提示词'), input.durationSeconds) };
  }
  if (purpose !== 'library-match') throw new Error('未知剧本分析任务。');
  const input = validateLibraryInput(body);
  if (input.segmented) {
    const candidates = segmentCandidates(input, parseSegments(await ask(segmentMessages(input, 'library'), '按情节分析剧本'), input, 'library'));
    const segments = candidates.some(segment => segment.candidates.length)
      ? parseSegmentMatches(await ask(segmentMatchMessages(input, candidates), '匹配各情节的本地音乐'), candidates)
      : candidates.map(({ candidates, ...segment }) => ({ ...segment, matches: [], evaluated: 0 }));
    return { segments, matches: [], analysis: { summary: `剧本已分为 ${segments.length} 个情节，各段音乐推荐见下方。`, keywords: [...new Set(segments.flatMap(s => s.keywords))].slice(0, 30) }, total: input.tracks.length, evaluated: candidates.reduce((n, s) => n + s.candidates.length, 0) };
  }
  const analysis = parseKeywords(await ask(keywordMessages(input), '提取剧本关键词'));
  const candidates = shortlistTracks(input.tracks, analysis.keywords, input.customKeywords);
  const matches = candidates.length ? parseMatches(await ask(matchMessages(input, analysis, candidates), '匹配本地音乐标题'), candidates) : [];
  return { analysis, matches, customKeywords: input.customKeywords, total: input.tracks.length, evaluated: candidates.length };
}

export function webTaskPrompt(messages, token) {
  return messages.map(message => message.content).join('\n\n') + `\n\n本次任务标识：${token}\n回复时将上面要求的 JSON 对象放入顶级 result 字段，并加入顶级 xmTaskId 字段，其字符串值必须为本次任务标识。只返回这一个 JSON 对象，不要复述输入或输出思考过程。`;
}
export function webTaskResult(text, token, manual = false) {
  if (typeof text !== 'string' || text.length > 200000) return null;
  // Parse complete objects only, ignoring braces inside quoted strings and partial streams.
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (start < 0) { if (char !== '{') continue; start = at; depth = 1; continue; }
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
        try {
          const object = JSON.parse(text.slice(start, at + 1));
          if (object.xmTaskId === token && object.result && typeof object.result === 'object' && !Array.isArray(object.result)) return JSON.stringify(object.result);
          if (manual && !('xmTaskId' in object) && (object.segments || object.keywords || object.matches || object.structure)) return JSON.stringify(object);
        } catch { /* Not a JSON response. */ }
        start = -1;
    }
  }
  return null;
}
