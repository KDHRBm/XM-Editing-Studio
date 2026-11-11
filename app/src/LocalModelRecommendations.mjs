export const LOCAL_MODEL_OPTIONS = [
  { id: 'deepseek-r1:1.5b', size: '1.1 GB', label: '1.5B · 入门测试', detail: '适合低配置设备，剧本分析质量有限。' },
  { id: 'deepseek-r1:7b', size: '4.7 GB', label: '7B · 速度优先', detail: '适合中端显卡与 16 GB 以上内存。' },
  { id: 'deepseek-r1:14b', size: '9 GB', label: '14B · 质量优先', detail: '需 12 GB 以上显存，或更大内存承担部分推理。' },
  { id: 'deepseek-r1:32b', size: '20 GB', label: '32B · 高配', detail: '建议 24 GB 显存与 64 GB 内存。' },
  { id: 'deepseek-r1:70b', size: '43 GB', label: '70B · 工作站', detail: '建议 48 GB 显存与 96 GB 内存，普通电脑不适合。' },
];

export function recommendLocalModel(hardware) {
  if (!hardware || !Number.isFinite(hardware.ramGB)) return { id: '', reason: '设备信息未读取成功，请手动选择。' };
  const ram = hardware.ramGB, vram = Number(hardware.vramGB) || 0;
  if (vram >= 48 && ram >= 96) return { id: 'deepseek-r1:70b', reason: '显存与内存达到工作站档位。' };
  if (vram >= 24 && ram >= 64) return { id: 'deepseek-r1:32b', reason: '显存与内存适合 32B。' };
  if (vram >= 12 && ram >= 32) return { id: 'deepseek-r1:14b', reason: '显存与内存适合 14B。' };
  if (vram >= 6 && ram >= 16) return { id: 'deepseek-r1:7b', reason: '显存适合 7B；14B 可能需要频繁使用内存，速度较慢。' };
  if (ram >= 24) return { id: 'deepseek-r1:7b', reason: '可依靠内存运行 7B，但缺少足够显存，速度会较慢。' };
  if (ram >= 8) return { id: 'deepseek-r1:1.5b', reason: '内存或显存不足以流畅运行更大的模型。' };
  return { id: '', reason: '可用内存低于 8 GB，暂不建议在本机部署。' };
}
