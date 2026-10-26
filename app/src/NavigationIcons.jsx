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
