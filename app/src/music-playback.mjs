export function installMusicPlayback(document) {
  let current = null;
  const isAudio = target => target?.tagName === 'AUDIO';
  const onPlay = event => {
    if (!isAudio(event.target)) return;
    current = event.target;
    for (const audio of document.querySelectorAll('audio')) if (audio !== current && !audio.paused) audio.pause();
  };
  const onKeyDown = event => {
    if (!(event.code === 'Space' || event.key === ' ') || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    const target = event.target;
    if (target?.isContentEditable || target?.closest?.('input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="button"], [role="slider"]')) return;
    if (!current?.isConnected) { current = null; return; }
    event.preventDefault(); event.stopPropagation();
    if (event.repeat) return;
    if (!current.paused) current.pause();
    else if (!current.closest?.('[hidden]')) {
      const result = current.play();
      result?.catch?.(() => {}); // Media controls display load/play errors.
    }
  };
  document.addEventListener('play', onPlay, true);
  document.addEventListener('keydown', onKeyDown, true);
  return () => {
    document.removeEventListener('play', onPlay, true);
    document.removeEventListener('keydown', onKeyDown, true);
    current = null;
  };
}
