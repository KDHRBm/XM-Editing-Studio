import { PROJECT_LIMIT, newProject, rememberProject, scriptName, clearCurrentProject } from '../shared/script-projects.mjs';
import { sameLibraryRequest } from '../shared/library-search.mjs';
const KEY = 'xiaoma.script-projects.v1';
const listeners = new Set();
let state;
try { state = JSON.parse(localStorage.getItem(KEY)); } catch { /* fresh installation */ }
if (!Array.isArray(state?.projects) || !state.projects.length) {
  let legacy; try { legacy = JSON.parse(localStorage.getItem('black-obsidian.script-draft.v1')); } catch { /* no legacy draft */ }
  const project = newProject(legacy || {}); state = { projects: [project], activeId: project.id, history: [] };
}
state = { ...state, projects: state.projects.slice(0, PROJECT_LIMIT), history: (state.history || []).slice(0, 5), storageError: '' };
// Retire the removed requirements field for future requests; keep historical results intact.
for (const key of ['projects', 'history']) state[key] = state[key].map(project => ({ ...project, draft: { ...project.draft, hint: '' } }));
function publish(next) {
  state = { ...next, storageError: '' };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { state.storageError = '剧本保存失败，请复制备份当前文本并释放存储空间。'; }
  listeners.forEach(fn => fn());
}
const current = () => state.projects.find(p => p.id === state.activeId) || state.projects[0];
const saveCurrent = () => rememberProject(state.history, current());
export function useScriptProjects() {
  const value = i.useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
  const historyRevision = value.historyRevision || 0;
  return {
    ...value, project: current(),
    clearCurrent() { publish(clearCurrentProject(state)); },
    clearHistory() { publish({ ...state, history: [], historyRevision: (state.historyRevision || 0) + 1 }); },
    change(values) { const p = current(); const draft = { ...p.draft, ...values }; draft.title = scriptName(draft.script); publish({ ...state, projects: state.projects.map(item => item.id === p.id ? { ...item, draft } : item) }); },
    select(id) { publish({ ...state, history: saveCurrent(), activeId: id }); },
    add() { if (state.projects.length >= PROJECT_LIMIT) throw new Error('最多同时编辑 5 份剧本。可关闭一个标签，原文和推荐会保存到最近 5 份历史中。'); const p = newProject({ ...current().draft, script: '', customKeywords: '' }); publish({ ...state, history: saveCurrent(), projects: [...state.projects, p], activeId: p.id }); },
    close(id) { const p = state.projects.find(item => item.id === id); let projects = state.projects.filter(item => item.id !== id); if (!projects.length) projects = [newProject()]; publish({ ...state, history: rememberProject(state.history, p), projects, activeId: state.activeId === id ? projects[0].id : state.activeId }); },
    remember(projectId, record) {
      const project = state.projects.find(p => p.id === projectId);
      const captured = { ...(project || newProject()), draft: { ...(project?.draft || {}), ...record }, recommendation: record };
      delete captured.draft.value; delete captured.draft.revision;
      // A response started before clearing history may update an open script,
      // but must not recreate the deleted history entries.
      publish({ ...state, projects: state.projects.map(p => p.id === projectId && sameLibraryRequest(p.draft, record) ? { ...p, recommendation: record } : p), history: historyRevision === (state.historyRevision || 0) ? rememberProject(state.history, captured, record) : state.history });
    },
    restore(id) {
      const item = state.history.find(p => p.id === id); if (!item) return;
      const existing = state.projects.find(p => sameLibraryRequest(p.draft, item.draft));
      if (existing) { publish({ ...state, activeId: existing.id, projects: state.projects.map(p => p.id === existing.id ? { ...p, recommendation: item.recommendation } : p) }); return; }
      if (state.projects.length >= PROJECT_LIMIT) throw new Error('当前已打开 5 份剧本，请先关闭一个标签，再打开历史剧本。');
      const p = { ...newProject(item.draft), recommendation: item.recommendation }; publish({ ...state, history: saveCurrent(), activeId: p.id, projects: [...state.projects, p] });
    },
  };
}
