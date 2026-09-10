---
'posthog-js': patch
---

Keep the end of a session recording when one replay event is too large to stringify, instead of the size estimate throwing and stopping the unload flush.
