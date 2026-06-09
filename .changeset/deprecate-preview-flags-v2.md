---
"posthog-js": patch
"@posthog/types": patch
---

Deprecate the no-op `__preview_flags_v2` browser SDK config option. The SDK already uses the `/flags/?v=2` endpoint by default.
