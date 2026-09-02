---
'posthog-js': patch
---

Gate `$groupidentify` on person processing. Under `identified_only`, a `group()` call promotes the user to identified so the event is kept instead of dropped. Under `never`, the local group association is retained for subsequent events and feature flags, but `$groupidentify` is not sent because the server always drops it.
