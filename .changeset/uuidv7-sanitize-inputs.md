---
'@posthog/core': patch
---

Sanitize the UUIDv7 generator's inputs so it never throws and always returns a valid **v7** id. `V7Generator` validates its timestamp and random fields and throws `RangeError` when `Date.now()` or `Math.random()` misbehaves (legacy `Date` polyfills — see #710 — or a broken RNG/clock on some Android devices). Because every SDK call funnels through `uuidv7()` via session/anonymous id generation, that throw previously crashed the host app. The clock is now clamped into the 48-bit range and the RNG output is coerced with ToUint32 (`>>> 0`) before the fields are assembled, so generation degrades gracefully while preserving the v7 version that session tracking and id bootstrapping rely on. Healthy environments are byte-for-byte unaffected.
