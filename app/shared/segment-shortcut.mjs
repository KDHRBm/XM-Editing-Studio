import { validateScoreRequest, validateScript } from './script-score.mjs';

export function segmentScoreInput(input, segment) {
  const rows = validateScript(input.script).split('\n');
  if (!segment || !Number.isInteger(segment.startLine) || !Number.isInteger(segment.endLine) || segment.startLine < 1 || segment.endLine < segment.startLine || segment.endLine > rows.length) throw new Error('情节范围已失效，请重新分析剧本。');
  return validateScoreRequest({
    ...input, title: segment.title, segmented: false,
    script: rows.slice(segment.startLine - 1, segment.endLine).join('\n'),
    lines: input.lines?.filter(line => line.sourceLine >= segment.startLine && line.sourceLine <= segment.endLine).map(line => ({ ...line, sourceLine: line.sourceLine - segment.startLine + 1 })),
    segmentContext: { title: segment.title, summary: segment.summary, keywords: segment.keywords },
  });
}

export function findSegmentJob(jobs, input, segment, projectId) {
  const scoped = segmentScoreInput(input, segment);
  return jobs.find(job => job.shortcutProjectId === projectId && job.segment?.startLine === segment.startLine && job.segment?.endLine === segment.endLine && job.script === scoped.script && job.hint === scoped.hint && job.durationSeconds === scoped.durationSeconds && job.subtitleLanguage === scoped.subtitleLanguage && JSON.stringify(job.segmentContext) === JSON.stringify(scoped.segmentContext));
}
