const rules: (blockClass: string) => string[] = (blockClass: string) => [
  `.${blockClass} { background: currentColor }`,
  'noscript { display: none !important; }',
  // Hide the browser's native media control bar during replay. The replayer sets
  // playback state on each media element itself, so the native controls never do
  // anything. They surface when a recorded page keeps `controls` on the element
  // but hides the bar with CSS the snapshot could not inline, which stacks a
  // second set of controls over the site's own bar.
  'video::-webkit-media-controls, audio::-webkit-media-controls, video::-webkit-media-controls-enclosure, audio::-webkit-media-controls-enclosure { display: none !important; }',
  // Emulate native fullscreen on playback: native fullscreen produces no DOM
  // mutation, so the recorder marks the element with `rr_fullscreen` instead.
  '[rr_fullscreen] { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; margin: 0 !important; max-width: none !important; max-height: none !important; z-index: 2147483647 !important; }',
];

export default rules;
