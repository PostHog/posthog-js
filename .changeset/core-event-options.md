---
'@posthog/core': minor
---

- Accept capture options on `alias()`, `setPersonProperties()` and `unsetPersonProperties()`, apply `identify()`'s capture options to the `$set` event it sends for an already-identified user, and show an event's `options` to `before_send`
- Fix `setPersonProperties()` ignoring a repeat call with the same properties after `before_send` dropped the earlier `$set` event or changed its distinct ID, `$set` or `$set_once`, or after that event was sent without person processing. A repeat call is now skipped only when the same properties went out on a `$set` event that processes the person
