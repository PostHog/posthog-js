---
'@posthog/browser-common': patch
'posthog-js': patch
---

Stop reporting a dead click every time a person opens a native picker. A `<select>` or a file, color, date, or time `<input>` draws its list in the browser or the operating system, so the click causes no mutation, scroll, or selection change and always hit the absolute timeout. Dead-click detection now skips these the same way it already skips anchors.
