// Match the fork's short fade/slide without moving the native AI browser surface.
export function useInterfaceMotion(route) {
  const animate = node => {
    if (!node?.getClientRects().length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (node.matches('.bos-web-ai') || node.querySelector('.bos-web-ai-slot')) return;
    node.getAnimations().forEach(animation => { if (animation.id === 'xm-reveal') animation.cancel(); });
    const animation = node.animate([
      { opacity: 0, transform: 'translateY(10px) scale(.992)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' });
    animation.id = 'xm-reveal';
  };
  i.useLayoutEffect(() => {
    const content = document.querySelector('.main-content');
    if (!content) return;
    [...content.children].forEach(animate);
    if (route === 'webai') animate(content.querySelector('.bos-web-ai-bar'));
  }, [route]);
  i.useEffect(() => {
    const content = document.querySelector('.main-content');
    if (!content) return;
    const observer = new MutationObserver(records => {
      const nodes = [...new Set(records.map(record => record.target))].filter(node => !node.hidden);
      nodes.filter(node => !nodes.some(parent => parent !== node && parent.contains(node))).forEach(animate);
    });
    observer.observe(content, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
    const toggle = event => { if (event.target.matches('details[open]')) [...event.target.children].filter(node => node.tagName !== 'SUMMARY').forEach(animate); };
    content.addEventListener('toggle', toggle, true);
    return () => { observer.disconnect(); content.removeEventListener('toggle', toggle, true); };
  }, []);
}
