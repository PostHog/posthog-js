---
'posthog-js': patch
---

Keep the end of a session recording when one replay event is too large to stringify: that event is dropped and the rest of the buffer still ships, instead of the size estimate throwing and stopping the unload flush.
