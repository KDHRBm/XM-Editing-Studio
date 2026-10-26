export function localSelectionScope(projectId, segment) {
  return { projectId, startLine: segment?.startLine || 0, endLine: segment?.endLine || 0 };
}

// New selections carry a project/scene scope. Older local tasks can be matched
// by their original script and subtitle lines without touching archived works.
export function findLocalSelections(jobs, { projectId, script, segment, lines }, trackId) {
  const scope = localSelectionScope(projectId, segment);
  return jobs.filter(job => {
    if (job.archived || job.source !== 'library' || job.localTrack?.id !== trackId || job.script !== script.replace(/\r\n?/g, '\n')) return false;
    if (job.localSelection) return job.localSelection.projectId === scope.projectId && job.localSelection.startLine === scope.startLine && job.localSelection.endLine === scope.endLine;
    return Array.isArray(lines) && Array.isArray(job.lines) && job.lines.length === lines.length && job.lines.every((line, index) => line.sourceLine === lines[index].sourceLine && line.text === lines[index].text);
  });
}
