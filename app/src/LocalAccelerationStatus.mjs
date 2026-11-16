export const LOCAL_ACCELERATION_OPTIONS = [
  { value: 'auto', label: '自动选择显卡' },
  { value: 'vulkan', label: 'Vulkan 兼容（AMD 推荐）' },
  { value: 'rocm', label: 'ROCm（需已安装组件）' },
  { value: 'cpu', label: '仅 CPU' },
];
export function localAccelerationMessage(acceleration) {
  switch (acceleration?.usageState) {
    case 'gpu': return '显卡已参与推理';
    case 'cpu': return '当前模型仅使用 CPU，未占用显存';
    case 'idle': return '尚未加载模型；开始本地分析后可查看显存占用';
    case 'stopped': return '启动本地服务后检查加速状态';
    default: return '暂未取得模型显存状态，请刷新重试';
  }
}
export const localVramText = model => Number.isFinite(model?.vramBytes) && model.vramBytes >= 0
  ? `${(model.vramBytes / 1073741824).toFixed(2)} GB` : '未知';
