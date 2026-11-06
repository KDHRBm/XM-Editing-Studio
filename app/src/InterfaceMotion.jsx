export function useInterfaceMotion(route) {
  i.useLayoutEffect(() => {
    const content = document.querySelector('.main-content');
    if (!content || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const nodes = [...content.children].flatMap(node =>
      node.matches('.bos-web-ai') || node.querySelector('.bos-web-ai-slot')
        ? [...node.querySelectorAll('.bos-web-ai-bar')]
        : [node]);
    for (const node of nodes) {
      if (!node.getClientRects().length) continue;
      node.getAnimations().forEach(animation => { if (animation.id === 'xm-reveal') animation.cancel(); });
      const animation = node.animate([
        { opacity: 0, translate: '0 6px' },
        { opacity: 1, translate: '0 0' },
      ], {
        duration: 280,
        easing: 'cubic-bezier(.22,1,.36,1)',
      });
      animation.id = 'xm-reveal';
    }
  }, [route]);
}
