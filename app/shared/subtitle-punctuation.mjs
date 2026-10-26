import { normalizeSubtitlePunctuation } from './period-text.mjs';

const MAX_FILE_CHARS = 2_000_000;
const MAX_CUES = 10000;
const timestamp = /^(\d{2,}:([0-5]\d):([0-5]\d)[,.](\d{3}))\s+-->\s+(\d{2,}:([0-5]\d):([0-5]\d)[,.](\d{3}))(?:\s+X1:\d+\s+X2:\d+\s+Y1:\d+\s+Y2:\d+)?$/;
const fail = message => { throw new Error(message); };
const timeValue = value => { const [h, m, s, ms] = value.split(/[:,.]/).map(Number); return ((h * 60 + m) * 60 + s) * 1000 + ms; };

export function parseSrt(input) {
  if (typeof input !== 'string' || input.length > MAX_FILE_CHARS) fail('SRT 文件过大，请按剧本分段导出后重试。');
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized || normalized.includes('\uFFFD')) fail('字幕文件为空或编码无法读取，请从剪映导出 UTF-8 编码的 SRT。');
  const blocks = normalized.split(/\n[\t ]*\n+/);
  if (blocks.length > MAX_CUES) fail('字幕条数过多，请分段处理。');
  return blocks.map((block, index) => {
    const rows = block.split('\n');
    if (rows.length < 3 || !/^\d+$/.test(rows[0].trim())) fail(`第 ${index + 1} 条字幕格式无效，请选择剪映导出的 SRT 文件。`);
    const timing = rows[1].trim(), match = timing.match(timestamp);
    if (!match || timeValue(match[5]) < timeValue(match[1])) fail(`第 ${index + 1} 条字幕时间码无效。`);
    const text = rows.slice(2).join('\n');
    if (!text.trim()) fail(`第 ${index + 1} 条字幕没有文字。`);
    return { index: rows[0].trim(), timing, text };
  });
}

function atoms(text) {
  const result = []; let offset = 0;
  for (const char of text) {
    if (/[\p{L}\p{N}\p{M}]/u.test(char)) result.push({ key: char.toLowerCase(), start: offset, end: offset + char.length });
    offset += char.length;
  }
  return result;
}

function plainSrt(text) {
  return text.replace(/<\/?(?:i|b|u|font)(?:\s[^>]*)?>/gi, '').normalize('NFKC');
}

function cueBoundary(text, left, right) {
  // Opening quotation marks belong to the next cue; closing marks stay with the previous one.
  const gap = text.slice(left.end, right.start);
  const opening = gap.search(/[“‘「『¿¡]/);
  if (opening >= 0) return left.end + opening;
  const straight = gap.search(/\s["']/);
  return straight >= 0 ? left.end + straight + 1 : right.start;
}

export function restoreSrtPunctuation(original, srt) {
  if (typeof original !== 'string' || !original.trim() || original.length > 60000) fail('请先整理当前剧本的台词，再选择同一份剧本的 SRT。');
  const source = normalizeSubtitlePunctuation(original).normalize('NFKC').trim();
  const sourceAtoms = atoms(source);
  if (!sourceAtoms.length) fail('当前台词没有可匹配的文字。');
  const cues = parseSrt(srt);
  const cueAtoms = cues.map(cue => atoms(plainSrt(cue.text)));
  if (cueAtoms.some(value => !value.length)) fail('SRT 中有只有标点或控制符的字幕，请先在剪映合并这些字幕再导出。');
  const actual = cueAtoms.flat();
  let mismatch = 0;
  while (mismatch < Math.min(actual.length, sourceAtoms.length) && actual[mismatch].key === sourceAtoms[mismatch].key) mismatch++;
  if (mismatch !== actual.length || mismatch !== sourceAtoms.length) {
    let through = 0, cue = 0;
    while (cue < cueAtoms.length - 1 && through + cueAtoms[cue].length <= mismatch) through += cueAtoms[cue++].length;
    fail(`约第 ${cue + 1} 条字幕的文字与当前台词不一致，未生成文件。请确认 SRT 与当前剧本、语言一致，并先校对漏句或错字；本功能只还原标点，不猜测或覆盖不同台词。`);
  }
  let used = 0, start = 0, changed = 0;
  const restored = cues.map((cue, index) => {
    used += cueAtoms[index].length;
    const end = used === sourceAtoms.length ? source.length : cueBoundary(source, sourceAtoms[used - 1], sourceAtoms[used]);
    const text = source.slice(start, end).replace(/(\p{Script=Han}[\p{P}]*)[\t ]*\n\s*(?=\p{Script=Han})/gu, '$1').replace(/\s+/g, ' ').trim();
    start = end;
    if (!text) fail('字幕分段与原文不兼容，请检查剪映是否将一个字或符号拆到了两条字幕。');
    if (text !== plainSrt(cue.text).replace(/\s+/g, ' ').trim()) changed++;
    return { ...cue, text };
  });
  return { text: restored.map(cue => `${cue.index}\r\n${cue.timing}\r\n${cue.text}`).join('\r\n\r\n') + '\r\n', cues: restored.length, changed, preview: restored.slice(0, 3).map(cue => cue.text) };
}

export function periodKeeperStatusText(state) {
  const labels = { offline: '未检测到剪映，请先打开剪映', standby: '剪映已启动，请进入草稿编辑页面', ready: '剪映编辑引擎已就绪', active: '兼容规则已加载，字幕结果尚未验证', unsupported: '当前剪映版本未找到兼容规则，可启用兼容保护', denied: '无法访问剪映，请确认两个程序以相同权限运行' };
  return labels[state?.engine] || '状态待确认';
}
