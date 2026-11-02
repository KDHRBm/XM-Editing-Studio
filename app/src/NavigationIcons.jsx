function NavGlyph({ size = 23, weight = 'regular', children, ...props }) {
  return <svg {...props} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={weight === 'fill' ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}

export function BatchNavIcon(props) {
  return <NavGlyph {...props}><path d="M4 4v16h16M8 16v-5m5 5V7m5 9v-8" /><path d="m7 7 5-4 5 2 3-3" /></NavGlyph>;
}

export function JianyingNavIcon(props) {
  return <NavGlyph {...props}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4" /><path d="m10 9 4 3-4 3Z" fill="currentColor" stroke="none" /></NavGlyph>;
}

export function WatermarkNavIcon(props) {
  return <NavGlyph {...props}><path d="M4 17h16v4H4zM7 17v-2a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v2M10 12V8a3 3 0 1 1 4 0v4" /></NavGlyph>;
}

export function WebAiNavIcon(props) {
  return <NavGlyph {...props}><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 6.5c4 2 10 2 14 0M5 17.5c4-2 10-2 14 0" /></NavGlyph>;
}

export function PetNavIcon({ size = 25, ...props }) {
  // Original character silhouette: curled forelock, frilled headband, long hair and side bow.
  return <svg {...props} width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M11 5C9 1 15-.2 18 2.2M5.3 13.4C2.9 11.4 5.1 9 6.4 8.6c-1-2.1 1.2-4 3.2-3.5.4-2.1 3-2.6 4.5-1.3 1.4-1.8 4.2-1.5 5.1.3 2.3-.9 4.6.5 4.6 2.7 2.3-.1 3.8 2.2 2.7 4.2" />
    <path d="M6.5 21c-.2 3-1.4 5-3.2 6.8 2.7.8 4.5.2 5.8-1.2L8.7 29c2.7.3 4.3-.7 5.4-2.5M25.4 20.5c.3 3.5 1.3 5.7 3.3 7.1-2.1 1.4-4.5.8-6-1l.5 2.4c-2.6.4-4.4-.6-5.1-2.5" />
    <path d="M9.2 17.5c-.9 2.8-.7 5.2.6 6.8 1.6 2 3.8 2.8 6.1 2.8 2.4 0 4.7-.8 6.2-2.8 1.1-1.6 1.4-3.8.7-6.3" />
    <path d="M8.6 23.5c-1.3-.8-2.1-2.7-2.2-4.8l-3 .5c2.4-2.7 1.8-5.8 3.2-8.2C8.3 7.6 11.9 6 16 6s7.6 1.6 9.3 5c1.5 2.9.7 5.9 3.4 8.2l-3.1-.4c-.1 2.2-.8 3.7-2 4.7M8.6 17.8c2.5-1.3 3.7-3.1 3.8-5.8.5 3.3 1.8 5.5 4.2 7.1 1.4-1.7 1.8-3.7 1.7-6.5 1.3 3.2 3.4 4.5 5.5 4.9" />
    <path d="M24.6 12.3c-1.7-1.8-3-.9-2.7.4.1.9 1.1 1.6 2.3 1.8-.1 1.4.7 2.5 1.6 2.5 1.5.1 1.9-1.4.4-2.9" />
    <path d="M10.8 20.3h2.3m5.8 0h2.3M15 24h1.9" />
    <path d="M12 20.8v1.1m8.1-1.1v1.1" strokeWidth="2" />
  </svg>;
}

export function UpdateNavIcon(props) {
  return <NavGlyph {...props}><path d="M20 8a8 8 0 1 0 1 6" /><path d="M20 3v5h-5" /></NavGlyph>;
}
