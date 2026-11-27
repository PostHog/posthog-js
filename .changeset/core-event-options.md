---
'@posthog/core': minor
---

Accept capture options on `alias()`, `setPersonProperties()` and `unsetPersonProperties()`, apply `identify()`'s capture options to the `$set` event it sends for an already-identified user, and show an event's `options` to `before_send`
