import { sameLibraryRequest } from './library-search.mjs';
export const PROJECT_LIMIT = 5;
export const HISTORY_LIMIT = 5;
export function scriptName(script = '') {
  const first = script.split(/\r?\n/).find(line => line.trim()) || '未填写剧本';
  return first.replace(/^\[EN\]\s*/i, '').trim().slice(0, 34);
}
export function newProject(draft = {}) {
  return { id: crypto.randomUUID(), draft: { script: '', customKeywords: '', durationSeconds: 90, geminiKey: '', sunoKey: '', sourceMode: 'library', subtitleLanguage: 'auto', segmented: false, segmentCount: 3, ...draft, hint: '', title: scriptName(draft.script) }, recommendation: null };
}
export function clearCurrentProject(state) {
  const current = state.projects.find(project => project.id === state.activeId) || state.projects[0];
  const empty = newProject({ ...current.draft, script: '', hint: '', customKeywords: '' });
  return { ...state, activeId: empty.id, projects: state.projects.map(project => project.id === current.id ? empty : project) };
}
export function rememberProject(history, project, record = project.recommendation) {
  if (!project.draft.script.trim()) return history;
  const draft = { ...project.draft };
  const previous = history.find(item => sameLibraryRequest(item.draft, draft));
  const recommendation = sameLibraryRequest(record, draft) ? record : previous?.recommendation || null;
  return [{ id: previous?.id || crypto.randomUUID(), draft, recommendation, savedAt: new Date().toISOString() }, ...history.filter(item => item !== previous)].slice(0, HISTORY_LIMIT);
}
