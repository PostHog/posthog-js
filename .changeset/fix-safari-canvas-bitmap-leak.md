---
"posthog-js": patch
---

Fix memory leak in canvas recording on Safari < 16.4 where ImageBitmaps were never closed when OffscreenCanvas was unavailable in the web worker.
