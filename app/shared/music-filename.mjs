const moods = [
  ['悬疑紧张', /悬疑|紧张|惊悚|\b(suspense\w*|tens(e|ion)|thriller)\b/i],
  ['悲伤伤感', /悲伤|伤感|哀伤|\b(sad|melanchol\w*|sorrow\w*)\b/i],
  ['温暖治愈', /温暖|治愈|温馨|\b(warm|healing|comfort\w*)\b/i],
  ['浪漫抒情', /浪漫|抒情|\b(romantic|romance|tender)\b/i],
  ['轻松喜剧', /喜剧|搞笑|诙谐|\b(comedy|comic|playful|quirky)\b/i],
  ['欢快明亮', /欢快|快乐|明亮|\b(happy|cheerful|upbeat|bright)\b/i],
  ['史诗激昂', /史诗|激昂|壮阔|\b(epic|heroic|triumphant)\b/i],
  ['宁静舒缓', /宁静|舒缓|平静|\b(calm|peaceful|relax\w*|serene)\b/i],
  ['黑暗压抑', /黑暗|压抑|阴暗|\b(dark|ominous|brooding)\b/i],
  ['希望励志', /希望|励志|\b(hopeful|inspiring|uplifting)\b/i],
  ['梦幻空灵', /梦幻|空灵|\b(dreamy|ethereal)\b/i],
  ['电影氛围', /电影|氛围|\b(cinematic|ambient)\b/i],
  ['流行', /流行|\bpop\b/i], ['爵士', /爵士|\bjazz\b/i], ['摇滚', /摇滚|\brock\b/i],
];
const instruments = [
  ['钢琴', /钢琴|\bpiano\b/i], ['小提琴', /小提琴|\bviolins?\b/i],
  ['大提琴', /大提琴|\bcellos?\b/i], ['弦乐', /弦乐|\bstrings?\b/i],
  ['吉他', /吉他|\bguitars?\b/i], ['竖琴', /竖琴|\bharp\b/i],
  ['长笛', /长笛|\bflutes?\b/i], ['单簧管', /单簧管|\bclarinet\b/i],
  ['萨克斯', /萨克斯|\bsax(ophone)?\b/i], ['铜管', /铜管|\bbrass\b/i],
  ['小号', /小号|\btrumpet\b/i], ['圆号', /圆号|\bfrench horn\b/i],
  ['古筝', /古筝|\bguzheng\b/i], ['二胡', /二胡|\berhu\b/i],
  ['琵琶', /琵琶|\bpipa\b/i], ['笛子', /笛子|\bdizi\b/i],
  ['合成器', /合成器|\bsynth(esizer)?s?\b/i], ['音垫', /音垫|\bpads?\b/i],
  ['贝斯', /贝斯|\bbass\b/i], ['鼓', /鼓|\bdrums?\b/i],
  ['打击乐', /打击乐|\bpercussion\b/i], ['管弦乐', /管弦乐|\borchestra(l)?\b/i],
];

export function safeMusicStem(value, fallback = '氛围配乐_器乐') {
  let name = String(value || '').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 100).replace(/[. ]+$/g, '');
  if (!name) name = fallback;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}

// Names describe the creation plan; this does not infer a key from the audio.
export function musicFileStem(score = {}) {
  const text = `${score.style || ''} ${score.prompt || ''}`;
  const mood = typeof score.mood === 'string' && score.mood.trim() ? score.mood.trim().slice(0, 24) : moods.find(([, pattern]) => pattern.test(text))?.[0] || '氛围配乐';
  const supplied = Array.isArray(score.instruments) ? score.instruments.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 20)) : [];
  const names = [...new Set(supplied.length ? supplied : instruments.filter(([, pattern]) => pattern.test(text)).map(([name]) => name))].slice(0, 3);
  return safeMusicStem([mood, ...(names.length ? names : ['器乐'])].join('_'));
}
