---
'posthog-node': patch
---

With a flag definition cache provider, a client that loads definitions from the cache that differ from the ones it fetched, such as those an older release wrote, drops its ETag, so its next request gets the whole definitions instead of `304`.
