import { WatermarkStudio as NativeWatermarkStudio } from './WatermarkNative.tsx';

export function WatermarkStudio({ active }) {
  const frame = i.useRef(null);
  const [mode, setMode] = i.useState('local');
  const [browserVisited, setBrowserVisited] = i.useState(false);
  i.useEffect(() => { if (active && mode === 'browser') setBrowserVisited(true); }, [active, mode]);
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
    <div className="bos-watermark-mode" role="tablist" aria-label="水印处理方式">
      <button type="button" role="tab" aria-selected={mode === 'local'} className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>本地批量</button>
      <button type="button" role="tab" aria-selected={mode === 'browser'} className={mode === 'browser' ? 'active' : ''} onClick={() => setMode('browser')}>浏览器处理</button>
    </div>
    {mode === 'local' && <NativeWatermarkStudio active={active} />}
    {browserVisited && <iframe hidden={mode !== 'browser'} ref={frame} onLoad={syncTheme} title="浏览器样片水印处理工具" src="/watermarker/index.html" allow="autoplay" />}
  </section>;
}
