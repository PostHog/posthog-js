---
'posthog-js': patch
---

Stop treating a `<link rel=preload as=style>` resource hint as a stylesheet when recording. Because it carries the URL of the sheet it preloads, the recorder matched it to the loaded stylesheet and inlined the whole sheet onto it, putting the CSS in every full snapshot twice and reporting a failed stylesheet deferral on every snapshot.
