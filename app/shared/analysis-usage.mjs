// Prices are estimates from the official CNY price table dated 2026-11-13.
// Return both tariff periods; the account's invoice is authoritative (holidays vary).
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function analysisCallUsage(payload, { label, elapsedMs, provider, model }) {
  const raw = payload?.usage || {};
  const promptTokens = count(raw.prompt_tokens), completionTokens = count(raw.completion_tokens);
  const cacheHitTokens = count(raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens);
  const cacheMissTokens = count(raw.prompt_cache_miss_tokens) ?? (promptTokens != null && cacheHitTokens != null ? Math.max(0,promptTokens-cacheHitTokens) : null);
  const actualModel = typeof payload?.model === 'string' ? payload.model : model;
  const flash = /^deepseek-(?:flash|v4-flash(?:-vision-exp)?|v4\.1-flash(?:-1017)?)$/i.test(actualModel);
  const rates = provider.protocol === 'deepseek' ? flash ? [0.02,1,4] : /^deepseek-v4-pro$/i.test(actualModel) ? [0.15,4.5,13.5] : null : null;
  const cost = rates && cacheHitTokens != null && cacheMissTokens != null && completionTokens != null
    ? (cacheHitTokens*rates[0]+cacheMissTokens*rates[1]+completionTokens*rates[2])/1e6 : null;
  return { label, elapsedMs, model:actualModel, promptTokens, completionTokens, cacheHitTokens, cacheMissTokens,
    reasoningTokens:count(raw.completion_tokens_details?.reasoning_tokens),
    estimatedCny:cost == null ? null : {offPeak:cost,peak:cost*2,priceDate:'2026-11-13'} };
}
export function summarizeAnalysisUsage(calls, elapsedMs) {
  const sum = key => calls.length && calls.every(call=>call[key]!=null) ? calls.reduce((n,call)=>n+call[key],0) : null;
  const priced = calls.length && calls.every(call=>call.estimatedCny);
  return { id:crypto.randomUUID(), calls, elapsedMs, promptTokens:sum('promptTokens'), completionTokens:sum('completionTokens'),
    cacheHitTokens:sum('cacheHitTokens'),cacheMissTokens:sum('cacheMissTokens'),reasoningTokens:sum('reasoningTokens'),
    estimatedCny:priced ? {offPeak:calls.reduce((n,c)=>n+c.estimatedCny.offPeak,0),peak:calls.reduce((n,c)=>n+c.estimatedCny.peak,0),priceDate:'2026-11-13'} : null };
}
