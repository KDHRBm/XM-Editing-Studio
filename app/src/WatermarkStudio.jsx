export function WatermarkStudio({ active }) {
  const frame = i.useRef(null);
  const [visited, setVisited] = i.useState(active);
  i.useEffect(() => { if (active) setVisited(true); }, [active]);
  const syncTheme = () => {
    const shell = document.querySelector('.app-shell');
    if (!shell || !frame.current?.contentWindow) return;
    const style = getComputedStyle(shell);
    const names = ['bg', 'surface', 'raised', 'input', 'text', 'muted', 'border', 'accent', 'soft', 'on-accent', 'radius', 'control', 'scheme'];
    frame.current.contentWindow.postMessage({ type: 'xiaoma-theme', values: Object.fromEntries(names.map(name => [name, style.getPropertyValue('--ui-' + name).trim()])) }, location.origin);
  };
  i.useEffect(() => {
    const shell = document.querySelector('.app-shell');
    if (!shell) return;
    const observer = new MutationObserver(syncTheme);
    observer.observe(shell, { attributes: true, attributeFilter: ['data-bos-theme'] });
    return () => observer.disconnect();
  }, []);
  return <section className="bos-watermark" hidden={!active} aria-label="加样片水印">
    {visited && <iframe ref={frame} onLoad={syncTheme} title="样片水印处理工具" src="/watermarker/index.html" allow="autoplay" />}
  </section>;
}
