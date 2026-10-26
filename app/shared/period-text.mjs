// Keep output punctuation ASCII, including text copied by earlier protected-copy versions.
export function normalizeSubtitlePunctuation(text = '') {
  return String(text).replaceAll('\u2060', '')
    .replace(/[․﹒。．]/g, '.').replace(/[‚﹐，]/g, ',').replace(/[‥…]/g, '...')
    .replace(/\.(?:[ \t\u3000]*\.)+/g, '...')
    .replace(/[ \t\u3000]+([.,])/g, '$1');
}

export function subtitleClipboardError(error) {
  return (error?.message || '复制失败，请重试。').replace(/^Error invoking remote method ['"]bos:period-[^'"]+['"]:\s*(?:Error:\s*)?/, '');
}
