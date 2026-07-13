const rules: (blockClass: string) => string[] = (blockClass: string) => [
    `.${blockClass} { background: currentColor }`,
    'noscript { display: none !important; }',
    // Emulate native fullscreen on playback: native fullscreen produces no DOM
    // mutation, so the recorder marks the element with `rr_fullscreen` instead.
    '[rr_fullscreen] { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; margin: 0 !important; max-width: none !important; max-height: none !important; z-index: 2147483647 !important; }',
]

export default rules
