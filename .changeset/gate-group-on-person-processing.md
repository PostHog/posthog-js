---
'posthog-js': patch
---

Gate `group()` on person processing, like the other identity methods. Under `identified_only` a `group()` call now promotes the user to identified, so the `$groupidentify` event is kept instead of dropped. Under `never` the call is ignored and logs an error, instead of sending an event the server always drops.
