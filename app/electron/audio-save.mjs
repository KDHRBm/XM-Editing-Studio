import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, copyFile, unlink } from 'node:fs/promises';
import { safeMediaUrl } from '../shared/music-options.mjs';
import { safeMusicStem } from '../shared/music-filename.mjs';

export function audioExtension(bytes) {
  const b = Buffer.from(bytes);
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return '.aac';
  if (b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return '.mp3';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WAVE') return '.wav';
  if (b.subarray(0, 4).toString() === 'OggS') return '.ogg';
  if (b.subarray(0, 4).toString() === 'fLaC') return '.flac';
  if (b.subarray(4, 8).toString() === 'ftyp') return '.m4a';
  if (b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return '.webm';
  throw new Error('下载结果不是可识别的音频文件，请检查服务商的音频地址。');
}

export async function saveMusicAudio({ directory, url, name }, { fetcher = fetch, maxBytes = 250 * 1024 * 1024 } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('请选择有效的绝对文件夹路径。');
  const audioUrl = safeMediaUrl(url);
  if (!audioUrl) throw new Error('配乐尚未完成或音频地址无效。');
  directory = path.resolve(directory);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.xiaoma-${randomUUID()}.download`);
  let handle, stream, ownsTemporary = false;
  try {
    const response = await fetcher(audioUrl, { signal: AbortSignal.timeout(180_000) });
    stream = response.body;
    if (!response.ok || !stream) throw new Error(`音频下载失败（HTTP ${response.status}）。`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('音频超过 250 MB，已停止下载。');
    if (/text\/|json|xml/i.test(response.headers.get('content-type') || '')) throw new Error('服务商返回了文本或错误页面，无法保存音频。');
    handle = await open(temporary, 'wx'); ownsTemporary = true;
    let size = 0, signature = Buffer.alloc(0);
    for await (const bytes of stream) {
      size += bytes.length;
      if (size > maxBytes) throw new Error('音频超过 250 MB，已停止下载。');
      if (signature.length < 64) signature = Buffer.concat([signature, Buffer.from(bytes)]).subarray(0, 64);
      await handle.writeFile(bytes);
    }
    if (size < 16) throw new Error('音频文件为空或不完整。');
    const extension = audioExtension(signature);
    await handle.close(); handle = null;
    const stem = safeMusicStem(name);
    for (let number = 1; number <= 10000; number++) {
      const audioPath = path.join(directory, `${stem}${number > 1 ? `_${number}` : ''}${extension}`);
      try {
        // EXCL protects existing files even when exports finish concurrently.
        await copyFile(temporary, audioPath, constants.COPYFILE_EXCL);
        return { ok: true, path: audioPath, audioPath, bytes: size, kind: 'audio' };
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    throw new Error('同名音乐过多，请选择其他保存目录。');
  } finally {
    if (stream?.cancel) await stream.cancel().catch(() => {});
    if (handle) await handle.close().catch(() => {});
    if (ownsTemporary) await unlink(temporary).catch(() => {});
  }
}
