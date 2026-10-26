let queue;
export function connectScriptQueue(value) { queue = value; }
export function recoverScriptMusic(id, taskIds) {
  if (!queue?.snapshot().jobs.some(job => job.id === id)) throw new Error('原配乐任务无法恢复，请重新打开程序后查看。');
  queue.recover(id, taskIds);
}
