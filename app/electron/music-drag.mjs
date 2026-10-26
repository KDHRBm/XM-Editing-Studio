import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { mkdir, open, readFile, writeFile, rename, realpath, stat } from 'node:fs/promises';
import { audioExtension } from './audio-save.mjs';

// Native drag uses an existing audio file only. This service never fetches a URL.
export function createMusicDrag({ registryFile, resolveLocalTrack }) {
  const tokens = new Map();
  let records, writing = Promise.resolve();
  async function registry() {
    if (!records) records = readFile(registryFile, 'utf8').then(text => {
      const value = JSON.parse(text); return Array.isArray(value) ? value.filter(r => r && typeof r.url === 'string' && typeof r.path === 'string').slice(-2000) : [];
    }).catch(() => []);
    return records;
  }
  async function existingAudio(filename) {
    if (typeof filename !== 'string' || !path.isAbsolute(filename) || !/\.(mp3|wav|m4a|ogg|flac|aac|webm)$/i.test(filename)) throw new Error('请选择已经保存的音频文件。');
    const canonical = await realpath(filename);
    const info = await stat(canonical);
    if (!info.isFile() || info.size < 16) throw new Error('音频文件无效或已被删除。');
    const handle = await open(canonical, 'r');
    try { const bytes = Buffer.alloc(64); const { bytesRead } = await handle.read(bytes); audioExtension(bytes.subarray(0, bytesRead)); }
    finally { await handle.close(); }
    return { filename: canonical, size: info.size, modifiedAt: info.mtimeMs };
  }
  return {
    async remember(url, filename) {
      if (typeof url !== 'string' || !url) return;
      const record = { url, path: filename };
      writing = writing.catch(() => {}).then(async () => {
        const list = await registry();
        const next = [...list.filter(item => item.url !== url), record].slice(-2000);
        await mkdir(path.dirname(registryFile), { recursive: true });
        const temporary = registryFile + '.tmp';
        await writeFile(temporary, JSON.stringify(next), 'utf8'); await rename(temporary, registryFile);
        records = Promise.resolve(next);
      });
      return writing;
    },
    async prepare(input = {}) {
      let file;
      if (input.libraryId) {
        if (!/^[a-f0-9]{64}$/.test(input.libraryId)) throw new Error('音乐库标识无效。');
        const track = await resolveLocalTrack(input.libraryId);
        file = await existingAudio(track.filename);
      } else {
        const known = (await registry()).find(item => item.url === input.url);
        const filename = input.filePath || known?.path;
        if (!filename) return { ready: false, reason: '此作品只有在线链接，尚未保存，暂不可拖入剪映。' };
        file = await existingAudio(filename);
      }
      const token = randomUUID(); tokens.set(token, file);
      if (tokens.size > 2000) tokens.delete(tokens.keys().next().value);
      return { ready: true, token, name: path.basename(file.filename), path: file.filename };
    },
    fileForToken(token) {
      const file = tokens.get(token);
      if (!file) throw new Error('拖动已失效，请重新准备。');
      const canonical = realpathSync(file.filename), info = statSync(canonical);
      if (canonical !== file.filename || !info.isFile() || info.size !== file.size || info.mtimeMs !== file.modifiedAt) throw new Error('音频文件已移动或更新，请刷新后再拖动。');
      return canonical;
    },
  };
}
