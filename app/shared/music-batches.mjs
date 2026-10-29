// A submission keeps its identity when the planner replaces it with segments.
// Older queues already record parentId; never infer batches from titles or time.
export function musicBatchMetadata(job) {
  return {
    batchId: job.batchId || job.parentId || job.id,
    batchTitle: job.batchTitle || (job.parentId ? job.title?.replace(/\s*·\s*\d+\.\s.*$/, '').trim() : job.title) || '剧本配乐',
    batchCreatedAt: job.batchCreatedAt ?? job.createdAt ?? 0,
  };
}

export function groupMusicJobs(jobs) {
  const batches = new Map();
  for (const job of jobs) {
    if (job.archived) continue;
    const meta = musicBatchMetadata(job);
    if (!batches.has(meta.batchId)) batches.set(meta.batchId, { id: meta.batchId, title: meta.batchTitle, createdAt: meta.batchCreatedAt, jobs: [], complete: 0, active: 0, attention: 0 });
    const batch = batches.get(meta.batchId);
    batch.jobs.push(job);
    if (job.status === 'complete') batch.complete++;
    if (['planning', 'submitting', 'pending'].includes(job.status)) batch.active++;
    if (['error', 'uncertain', 'pausedQuery'].includes(job.status)) batch.attention++;
  }
  return [...batches.values()];
}
