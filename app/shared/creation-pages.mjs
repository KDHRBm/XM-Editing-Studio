export function creationRows(jobs) {
  return jobs.flatMap(job => job.tracks.length ? job.tracks.map((track, index) => ({ job, track, index })) : [{ job, track: null, index: -1 }]);
}
export function groupCreationRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.job.id)) groups.set(row.job.id, { job: row.job, tracks: [] });
    if (row.track) groups.get(row.job.id).tracks.push({ track: row.track, index: row.index });
  }
  return [...groups.values()];
}
