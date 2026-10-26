import { safeMediaUrl } from '../shared/music-options.mjs';

// Relays wrap the same task in data/result/clips/response.sunoData in different ways.
export function getSunoSongs(payload) {
  const tracks = new Map();
  function add(value, taskId, taskStatus) {
    const id = String(value.song_id || value.songId || value.clip_id || value.clipId || value.id || taskId || '');
    if (!id) return;
    const audioUrl = safeMediaUrl(value.audio_url || value.audioUrl || value.stream_audio_url || value.streamAudioUrl || value.download_url || value.downloadUrl || value.url);
    const track = {
      id, taskId: taskId || id, title: value.song_title || value.title || value.name || '',
      status: value.status || value.state || value.task_status || taskStatus || (audioUrl ? 'completed' : 'pending'),
      taskStatus: taskStatus || '', audioUrl,
      coverUrl: safeMediaUrl(value.cover_url || value.coverUrl || value.image_url || value.imageUrl),
      duration: value.duration || value.duration_s || '',
      error: String(value.fail_reason || value.error_message || value.errorMessage || (typeof value.error === 'string' ? value.error : '') || '').slice(0, 400),
    };
    tracks.set(`${track.taskId}:${track.id}`, track);
  }
  function visit(value, inheritedId = '', inheritedStatus = '', depth = 0) {
    if (depth > 10 || value == null) return;
    if (Array.isArray(value)) { value.forEach(v => visit(v, inheritedId, inheritedStatus, depth + 1)); return; }
    if (typeof value === 'string') { if (value.trim()) add({}, value.trim(), inheritedStatus); return; }
    if (typeof value !== 'object' || value.object === 'chat.completion') return;
    const keys = ['data', 'result', 'songs', 'clips', 'tasks', 'tracks', 'response', 'sunoData'];
    const nested = keys.filter(key => value[key] != null && (typeof value[key] === 'object' || ['data', 'result'].includes(key)));
    const explicitId = value.task_id || value.taskId || value.taskID;
    const taskId = String(explicitId || inheritedId || value.id || '');
    const status = String(value.status || value.state || value.task_status || inheritedStatus || '');
    const taskStatus = explicitId || nested.length ? status : inheritedStatus;
    const hasAudio = value.audio_url || value.audioUrl || value.stream_audio_url || value.streamAudioUrl || value.download_url || value.downloadUrl || value.url;
    const before = tracks.size;
    if (hasAudio) add(value, taskId, taskStatus);
    else nested.forEach(key => visit(value[key], taskId, status, depth + 1));
    for (const ids of [value.task_ids, value.ids]) if (Array.isArray(ids)) ids.forEach(id => add({}, String(id), status));
    if (tracks.size === before && taskId) add(value, taskId, taskStatus);
  }
  visit(payload);
  return [...tracks.values()];
}
