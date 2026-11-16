export function needsMusicSupplement(task) {
  const target = task.result?.recommendationTarget || (task.settings?.analysisMode === 'targeted' ? 3 : task.settings?.analysisMode === 'fast' ? 1 : 5);
  return task.status === 'complete' && (task.result?.segments || [task.result]).some(unit => (unit?.matches?.length || 0) < target);
}

export function batchUsageTotals(tasks) {
  const groups = [...new Map(tasks.flatMap(t=>t.usageHistory||[]).filter(u=>u?.id).map(u=>[u.id,u])).values()];
  const sum = key => groups.length && groups.every(g=>g[key]!=null) ? groups.reduce((n,g)=>n+g[key],0) : null;
  return {groups, calls:groups.reduce((n,g)=>n+g.calls.length,0), elapsedMs:sum('elapsedMs'),
    promptTokens:sum('promptTokens'),completionTokens:sum('completionTokens'),cacheHitTokens:sum('cacheHitTokens'),cacheMissTokens:sum('cacheMissTokens'),
    estimatedCny:groups.length && groups.every(g=>g.estimatedCny) ? {offPeak:groups.reduce((n,g)=>n+g.estimatedCny.offPeak,0),peak:groups.reduce((n,g)=>n+g.estimatedCny.peak,0)} : null};
}

export function exportBatchResults(projectName, tasks) {
  const usage=batchUsageTotals(tasks);
  const episodes=tasks.map(t=>({id:t.id,episodeNumber:t.episodeNumber,title:t.title,status:t.status,analyzer:t.analyzer,analysisMode:t.settings?.analysisMode||'standard',result:t.result,error:t.error||''}));
  const data={projectName,exportedAt:new Date().toISOString(),usage,episodes};
  const lines=[`# ${projectName} 配乐分析`, '', `API 请求：${usage.calls} 次；输入：${usage.promptTokens ?? '未知'} Token；输出：${usage.completionTokens ?? '未知'} Token。`,
    usage.estimatedCny ? `按官方价格估算：空闲时段 ¥${usage.estimatedCny.offPeak.toFixed(6)}；高峰时段 ¥${usage.estimatedCny.peak.toFixed(6)}。实际扣费以服务商账单为准。` : '费用：服务商未提供完整计费数据或不适用官方价。', ''];
  for(const episode of episodes) {
    lines.push(`## ${episode.title}`, '', episode.result?.analysis?.summary||episode.error||'尚未完成', '');
    for(const unit of episode.result?.segments || (episode.result ? [episode.result] : [])) {
      lines.push(`### ${unit.title||'整集配乐'}${unit.startLine ? `（原文 ${unit.startLine}–${unit.endLine} 行）` : ''}`, '', unit.summary||'', '');
      for(const match of unit.matches||[]) lines.push(`- ${match.title||match.id}：${match.reason}`);
      if(unit.noMatchReason) lines.push('',unit.noMatchReason);
      lines.push('');
    }
  }
  return {json:JSON.stringify(data,null,2),markdown:lines.join('\n')};
}
