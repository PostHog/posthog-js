---
'posthog-js': patch
---

Bump @posthog/rrweb-* to 0.0.45 — reuses a single OffscreenCanvas in the canvas recording worker instead of allocating a new one per frame, fixing a memory leak in Safari where GPU-backed canvas resources were not being garbage collected promptly
