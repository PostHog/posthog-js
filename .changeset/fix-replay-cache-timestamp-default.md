---
'posthog-js': patch
---

fix(replay): treat legacy configs without cache_timestamp as fresh

Configs persisted by older SDK versions never include a cache_timestamp.
Defaulting to 0 treats them as always stale, causing the persisted config
to be cleared before start() runs — so recording never starts for
customers on older core SDK versions paired with the latest CDN recorder.
