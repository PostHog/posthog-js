---
'posthog-node': patch
'@posthog/core': patch
---

Stop a throwing getter in `metrics.resourceAttributes` from breaking every metrics export — the key is recorded as `[Unserializable]` instead.
