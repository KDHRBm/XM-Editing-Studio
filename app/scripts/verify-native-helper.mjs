import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function verifyPeriodHelper(helperFile, integrityFile) {
  const manifest = await readFile(integrityFile, 'utf8');
  const expected = manifest.match(/export const HELPER_SHA256\s*=\s*['"]([a-f0-9]{64})['"]/i)?.[1].toLowerCase();
  if (!expected) throw new Error('标点组件校验清单无效，请重新构建原生组件。');
  let bytes;
  try { bytes = await readFile(helperFile); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`缺少标点组件：${helperFile}。请先构建原生组件，并同步到发布目录。`);
    throw error;
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`标点组件与程序校验值不匹配：${helperFile}。请同步同一次构建的 PeriodKeeper.exe 与 period-helper-integrity.mjs，不能继续发布。`);
  return { sha256: actual, bytes: bytes.length };
}
