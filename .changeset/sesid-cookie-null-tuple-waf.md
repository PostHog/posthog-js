---
'posthog-js': patch
---

Fix `posthog.reset()` and the forced-idle reset path writing `"$sesid":[null,null,null]` into the persistence cookie. After URL-decoding, the literal `[null,null,null]` substring was triggering some WAFs to flag legitimate requests as SQL injection attempts. The session id key is now removed from persistence on reset instead of being serialized as a null tuple. Behaviour is unchanged — the next call to `checkAndGetSessionAndWindowId` still allocates fresh ids.
