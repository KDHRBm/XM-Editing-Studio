export const isLocalModelName = value => typeof value === 'string' && value.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*:[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) && !value.includes('..');

export function modelBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '未知';
  if (value < 1000) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1000, unit = 0;
  while (size >= 1000 && unit < units.length - 1) { size /= 1000; unit++; }
  return `${size.toFixed(size >= 100 ? 0 : 2)} ${units[unit]}`;
}

export function installedModelRows(state) {
  const running = new Map((state?.acceleration?.models || []).map(model => [model.name, model]));
  const details = new Map((state?.modelDetails || []).filter(model => isLocalModelName(model.name)).map(model => [model.name, model]));
  // Compatibility with older native hosts. Destructive actions remain disabled.
  if (!Array.isArray(state?.modelDetails)) for (const name of state?.models || []) if (isLocalModelName(name)) details.set(name, { name, complete: true, sizeBytes: -1 });
  return [...details.values()].map(model => ({ ...model, loaded: running.has(model.name), vramBytes: running.get(model.name)?.vramBytes ?? -1 }));
}

export function removeLocalProviderModel(items, name) {
  return items.map(item => item.id === 'provider-ollama-local' && item.protocol === 'ollama'
    ? { ...item, models: (item.models || []).filter(model => model !== name) } : item);
}
