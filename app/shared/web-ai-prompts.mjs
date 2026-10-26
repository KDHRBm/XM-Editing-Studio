import { validateScoreRequest, scoreMessages } from './script-score.mjs';
import { validateLibraryInput, keywordMessages } from './library-match.mjs';
import { segmentMessages } from './script-segments.mjs';

export function webAIScriptPrompt(draft, purpose) {
  let messages;
  if (purpose === 'keywords') {
    const input = validateLibraryInput({ ...draft, tracks: [] });
    messages = input.segmented ? segmentMessages(input, 'library') : keywordMessages(input);
  } else if (purpose === 'suno') {
    const input = validateScoreRequest(draft);
    messages = input.segmented ? segmentMessages(input, 'suno') : scoreMessages(input);
  } else throw new Error('未知剧本辅助任务。');
  return messages.map(item => item.content).join('\n\n');
}
