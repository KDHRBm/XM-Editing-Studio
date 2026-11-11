const STORAGE_KEY = 'xm-local-model-inference-v1';

export const LOCAL_CONTEXT_OPTIONS = [4096, 8192, 16384, 32768, 65536, 131072];
export const LOCAL_OUTPUT_OPTIONS = [1024, 2048, 4096, 8192];
export const DEFAULT_LOCAL_MODEL_SETTINGS = Object.freeze({ contextTokens: 16384, outputTokens: 4096 });

export function normalizeLocalModelSettings(value) {
  const contextTokens = LOCAL_CONTEXT_OPTIONS.includes(value?.contextTokens)
    ? value.contextTokens : DEFAULT_LOCAL_MODEL_SETTINGS.contextTokens;
  const outputTokens = LOCAL_OUTPUT_OPTIONS.includes(value?.outputTokens) && value.outputTokens <= contextTokens / 2
    ? value.outputTokens : Math.min(DEFAULT_LOCAL_MODEL_SETTINGS.outputTokens, contextTokens / 2);
  return { contextTokens, outputTokens };
}

export function readLocalModelSettings(storage = globalThis.localStorage) {
  try { return normalizeLocalModelSettings(JSON.parse(storage?.getItem(STORAGE_KEY) || 'null')); }
  catch { return { ...DEFAULT_LOCAL_MODEL_SETTINGS }; }
}

export function saveLocalModelSettings(value, storage = globalThis.localStorage) {
  const settings = normalizeLocalModelSettings(value);
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  return settings;
}
