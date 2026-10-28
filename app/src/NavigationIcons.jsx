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

export function PetNavIcon(props) {
  return <NavGlyph {...props}><path d="M6 12c2-4 5-6 9-6 3 0 5 2 7 6-2 4-4 6-7 6-4 0-7-2-9-6Z" /><path d="m6 12-4-4v8l4-4ZM11 7l2-3 3 2" /><circle cx="17" cy="10" r=".8" fill="currentColor" stroke="none" /></NavGlyph>;
}

export function UpdateNavIcon(props) {
  return <NavGlyph {...props}><path d="M20 8a8 8 0 1 0 1 6" /><path d="M20 3v5h-5" /></NavGlyph>;
}
