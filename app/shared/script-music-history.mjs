export function scriptMusicHistory(job) {
  const local = job.source === 'library';
  return {
    id: `script-${job.id}`, scriptJobId: job.id, queueManaged: !job.historyDetached,
    providerId: job.suno?.providerId || '', baseUrl: job.suno?.baseUrl || '',
    model: local ? '本地音乐库' : job.suno?.model || '',
    title: local ? job.localTrack.title : job.score?.title || job.title,
    style: local ? job.analysis.keywords.join(', ') : job.score?.style || '',
    mood: job.score?.mood || '', instruments: job.score?.instruments || [],
    source: local ? 'library' : 'suno', createdAt: job.createdAt,
    tracks: job.tracks, taskIds: job.taskIds, primaryAudioUrl: job.primary?.audioUrl || "",
    status: ({ complete: 'complete', error: 'failed', pausedQuery: 'paused', uncertain: 'uncertain', submitting: 'submitting' })[job.status] || 'pending',
    error: job.error || '', exportPath: job.exportPath || '', exportError: job.exportError || '',
  };
}
