---
'posthog-js': patch
---

Fall back to in-memory storage when neither web storage nor cookies are available, instead of selecting a backend that cannot store anything. In contexts like a `data:` URL — a Figma plugin, for example — Chrome disables localStorage and cookies alike, and both the persistence and consent paths previously committed to an unusable store, logging a SecurityError on every capture. `cookieStore._is_supported()` now round-trips a probe cookie rather than only checking that `document` exists, and `memoryStore` no longer reports a stored falsy value (such as the `0` consent writes for "opted out") as absent.
