---
"posthog-js": patch
---

Skip canvas FPS recording entirely on browsers without OffscreenCanvas support (Safari < 16.4) instead of running a wasteful requestAnimationFrame loop that can never produce data.
