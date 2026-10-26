export const MUSIC_LIMITS = { style: 1000, title: 80, lyrics: 5000, brief: 3000, sections: 24 };

export const SECTION_TYPES = [
  ['Intro', '前奏'], ['Verse', '主歌'], ['Pre-Chorus', '预副歌'],
  ['Chorus', '副歌'], ['Bridge', '桥段'], ['Instrumental', '器乐间奏'],
  ['Solo', '独奏'], ['Build', '渐强'], ['Drop', '高潮'],
  ['Break', '停顿'], ['Outro', '尾奏'], ['End', '结束'],
];

export const STYLE_PRESETS = [
  ['Pop', '流行'], ['Rock', '摇滚'], ['Electronic', '电子'],
  ['Cinematic', '电影'], ['Jazz', '爵士'], ['Classical', '古典'],
  ['Hip-Hop', '嘻哈'], ['Country', '乡村'], ['R&B', '节奏蓝调'], ['Folk', '民谣'],
];

export function addStyleTag(value, tag) {
  const tags = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!tags.some(s => s.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  return tags.join(', ');
}

function bad(message) { throw Object.assign(new Error(message), { status: 400 }); }
function field(value, name, max) {
  if (value == null) return '';
  if (typeof value !== 'string') bad(`${name}格式无效。`);
  const text = value.trim();
  if (text.length > max) bad(`${name}不能超过 ${max} 个字符，请精简后再提交。`);
  return text;
}

export function serializeStructure(sections, instrumental = false) {
  if (!Array.isArray(sections) || sections.length > MUSIC_LIMITS.sections) bad('音乐结构最多包含 24 个段落。');
  const parts = sections.map(section => {
    if (!section || typeof section !== 'object') bad('音乐段落格式无效。');
    const tag = field(section.tag, '段落标签', 80);
    if (!tag || /[\[\]\r\n]/.test(tag)) bad('段落标签不能为空，也不能包含方括号或换行。');
    const content = field(section.content, '段落内容', MUSIC_LIMITS.lyrics);
    // Instrumental descriptions are performance directions, never lyrics.
    const body = instrumental && content
      ? content.split(/\r?\n/).filter(s => s.trim()).map(s => `[${s.replace(/[\[\]]/g, '').trim()}]`).join('\n')
      : content;
    return `[${tag}]${body ? '\n' + body : ''}`;
  });
  return [instrumental ? '[Instrumental]' : '', ...parts].filter(Boolean).join('\n\n');
}

export function autoTitle(prompt, fallback = '未命名作品') {
  return String(prompt || '').replace(/\[[^\]]*\]/g, '').split(/\r?\n/).map(s => s.trim()).find(Boolean)?.slice(0, MUSIC_LIMITS.title) || fallback;
}

export function normalizeMusicOptions(input) {
  const customMode = input.customMode === true;
  const instrumental = input.instrumental === true;
  const style = field(input.style, '音乐风格', MUSIC_LIMITS.style);
  let prompt;
  if (customMode && input.structure !== undefined) {
    if (!Array.isArray(input.structure) || !input.structure.length) bad('请至少添加一个音乐段落。');
    prompt = serializeStructure(input.structure, instrumental);
  } else {
    prompt = field(input.prompt, customMode ? '歌词 / 结构标签' : '音乐描述', customMode ? MUSIC_LIMITS.lyrics : MUSIC_LIMITS.brief);
    if (customMode && instrumental && !/^\s*\[Instrumental\]/i.test(prompt)) prompt = `[Instrumental]\n\n${prompt}`;
  }
  if (!prompt || prompt === '[Instrumental]') bad(customMode ? '请填写歌词或音乐结构。' : '音乐描述不能为空。');
  if (prompt.length > (customMode ? MUSIC_LIMITS.lyrics : MUSIC_LIMITS.brief)) bad('歌词及结构标签合计不能超过 5000 个字符。');
  if (customMode && !style) bad('自定义创作需要填写音乐风格。');
  const title = field(input.title, '歌曲标题', MUSIC_LIMITS.title) || autoTitle(prompt, instrumental ? '无词之境' : '新的旋律');
  const rawDuration = Number(input.durationSeconds);
  return {
    customMode, instrumental, style, title, prompt,
    durationSeconds: Number.isFinite(rawDuration) && rawDuration > 0 ? Math.max(15, Math.min(480, rawDuration)) : undefined,
  };
}

export function buildSunoBody(model, options) {
  return {
    model,
    title: options.title,
    prompt: options.customMode ? options.prompt : '',
    gpt_description_prompt: options.customMode ? '' : options.prompt,
    tags: options.style,
    make_instrumental: options.instrumental,
    instrumental: options.instrumental,
    custom_mode: options.customMode,
  };
}

export const isFailed = status => /^(failed|failure|error|cancelled|canceled|.*_failed|.*_error)$/i.test(String(status || ''));
export const isComplete = status => /^(completed|complete|success|succeeded|finished|done)$/i.test(String(status || ''));
export const safeMediaUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
};

export function mergeTracks(previous, incoming) {
  const byId = new Map(previous.map(track => [String(track.id || track.taskId), track]));
  for (const track of incoming) {
    if (!track.id && !track.taskId) continue;
    const key = String(track.id || track.taskId);
    const old = byId.get(key) || {};
    byId.set(key, { ...old, ...track, audioUrl: track.audioUrl || old.audioUrl || '', coverUrl: track.coverUrl || old.coverUrl || '' });
  }
  const values = [...byId.values()];
  return values.filter(track => !(track.id === track.taskId && !track.audioUrl && values.some(other => other !== track && other.taskId === track.taskId && other.id !== track.id)));
}
