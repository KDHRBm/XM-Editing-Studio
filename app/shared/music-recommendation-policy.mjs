export const MIN_MUSIC_RECOMMENDATIONS = 5;
export const MUSIC_RECOMMENDATION_RULE = '每个情节至少推荐5首、最多8首不同音乐，按契合度排序。候选中确实不足5首适合音乐时，保留全部合适项并用noMatchReason明确说明不足原因，不能重复凑数、编造ID或推荐情绪相反的曲目。';

export function needsMusicReview(unit, selection) {
  return !!unit.candidates.length && (selection.invalid || selection.matches.length < Math.min(MIN_MUSIC_RECOMMENDATIONS, unit.candidates.length));
}

export function mergeMusicSelections(previous, reviewed) {
  // A correction must not discard valid recommendations already received.
  // Keep the first valid reason/ordering when the correction repeats an ID.
  const matches = [...previous.matches];
  for (const match of reviewed.matches) if (!matches.some(item => item.id === match.id)) matches.push(match);
  return { ...reviewed, matches: matches.slice(0, 8) };
}

export function musicShortfall(selection, candidateCount) {
  if (selection.matches.length >= MIN_MUSIC_RECOMMENDATIONS) return '';
  if (!candidateCount) return '没有可用候选，请连接音乐库或检查最近使用记录。';
  return selection.noMatchReason || (candidateCount < MIN_MUSIC_RECOMMENDATIONS
    ? `当前仅有 ${candidateCount} 首可用候选，已保留其中合适的音乐；可补充音乐库后重试。`
    : `已复核候选，当前仅确认 ${selection.matches.length} 首有效推荐，未达到5首；可补充音乐库或重新匹配。`);
}
