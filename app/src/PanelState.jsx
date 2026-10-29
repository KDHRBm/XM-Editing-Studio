export function usePanelCollapsed(name) {
  const key = `black-obsidian.panel.${name}.v1`;
  const [collapsed, setCollapsed] = i.useState(() => { try { return localStorage.getItem(key) === 'true'; } catch { return false; } });
  const toggle = () => setCollapsed(current => { const next = !current; try { localStorage.setItem(key, String(next)); } catch { /* layout still updates */ } return next; });
  const set = value => { setCollapsed(Boolean(value)); try { localStorage.setItem(key, String(Boolean(value))); } catch {} };
  return [collapsed, toggle, set];
}
