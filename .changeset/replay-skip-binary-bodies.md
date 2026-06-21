---
'posthog-js': patch
---

Session replay network capture: never record binary/asset response or request bodies (image, video, audio, font, octet-stream, pdf, zip, wasm) even when `recordBody` is enabled - they bloat recordings, duplicate what the replay already shows, and the body is no longer read.
