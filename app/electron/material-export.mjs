import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, writeFile, rename, unlink, rmdir } from 'node:fs/promises';
import { validateScoreRequest, parseScoreResponse, materialTexts } from '../shared/script-score.mjs';
import { parseKeywords } from '../shared/library-match.mjs';
import { musicFileStem } from '../shared/music-filename.mjs';
import { audioExtension, saveMusicAudio } from './audio-save.mjs';
export { audioExtension } from './audio-save.mjs';

export async function exportScriptMaterials(payload, { fetcher = fetch, maxBytes = 250 * 1024 * 1024, resolveLocalTrack } = {}) {
  if (typeof payload?.directory !== 'string' || !path.isAbsolute(payload.directory)) throw new Error('请选择有效的绝对文件夹路径。');
  const input = validateScoreRequest(payload.job || {});
  const local = payload.job.source === 'library';
  const score = local ? undefined : parseScoreResponse(JSON.stringify(payload.job.score), input.durationSeconds);
  if (!local) return saveMusicAudio({ directory: payload.directory, url: payload.job.primary?.audioUrl, name: musicFileStem(score) }, { fetcher, maxBytes });
  const analysis = parseKeywords(JSON.stringify(payload.job.analysis));
  if (typeof resolveLocalTrack !== 'function') throw new Error('本地音乐库不可用，请重新连接音乐文件夹。');
  const localTrack = await resolveLocalTrack(payload.job.localTrack?.id);
  const matchReason = String(payload.job.matchReason || '').slice(0, 500);
  const directory = path.resolve(payload.directory);
  await mkdir(directory, { recursive: true });
  let name = input.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 70) || '剧本配乐';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = '_' + name;
  const folder = await mkdtemp(path.join(directory, `${name}-`));
  if (path.dirname(folder) !== directory) throw new Error('导出路径无效。');
  const created = [];
  let handle, audioStream;
  try {
    if (localTrack.size > maxBytes) throw new Error('音频超过 250 MB，无法导出。');
    const temporary = path.join(folder, '配乐.download');
    handle = await open(temporary, 'wx'); created.push(temporary);
    audioStream = createReadStream(localTrack.filename);
    let size = 0, signature = Buffer.alloc(0);
    for await (const bytes of audioStream) {
      size += bytes.length;
      if (size > maxBytes) throw new Error('音频超过 250 MB，已停止下载。');
      if (signature.length < 64) signature = Buffer.concat([signature, Buffer.from(bytes)]).subarray(0, 64);
      await handle.writeFile(bytes);
    }
    if (size < 16) throw new Error('音频文件为空或不完整。');
    const extension = audioExtension(signature);
    await handle.close(); handle = null;
    const audioName = `配乐${extension}`;
    const audioPath = path.join(folder, audioName);
    await rename(temporary, audioPath); created.push(audioPath);
    const texts = materialTexts({ ...input, source: local ? 'library' : 'suno', score, analysis, localTrack, matchReason });
    texts['素材清单.json'] = JSON.stringify({ version: 2, source: local ? 'local-library' : 'suno', musicTitle: localTrack?.title, title: input.title, createdAt: new Date().toISOString(), audio: audioName, audioBytes: size, targetSeconds: input.durationSeconds, actualSeconds: Number(payload.job.primary?.duration) || null, taskIds: (payload.job.taskIds || []).map(String).slice(0, 10), spokenLines: input.lines.filter(l => l.kind !== 'scene').length, files: [...Object.keys(texts), audioName] }, null, 2);
    for (const [fileName, content] of Object.entries(texts)) { const file = path.join(folder, fileName); created.push(file); await writeFile(file, content, { encoding: 'utf8', flag: 'wx' }); }
    return { ok: true, path: folder, audioPath, bytes: size };
  } catch (error) {
    if (audioStream?.destroy) audioStream.destroy();
    else if (audioStream?.cancel) await audioStream.cancel().catch(() => {});
    if (handle) await handle.close().catch(() => {});
    // Remove only files created by this operation, never any pre-existing folder.
    for (const file of created) await unlink(file).catch(() => {});
    await rmdir(folder).catch(() => {});
    throw error;
  }
}
