---
'posthog-js': patch
'@posthog/rrweb': patch
---

fix(replay): re-adopt constructed stylesheets when a shadow host is removed and re-added mid-replay. An SPA navigation can detach and reattach the same web component element; the browser keeps its shadow root and adopted sheets, so the recorder (which already tracks that shadow root) emits no new AdoptedStyleSheet event. The replayer rebuilds the element with a fresh shadow root and previously dropped the adopted styles for the rest of playback, rendering the component unstyled. The replayer now remembers the last adopted styleIds per host and re-adopts them when the shadow root is rebuilt, in both live playback and fast-forward. Fixes playback of existing recordings.
