---
'@posthog/core': patch
---

Fall back to UUIDv4 when the UUIDv7 generator throws. `V7Generator` validates its timestamp and random fields and throws `RangeError: invalid field value` when `Date.now()` or `Math.random()` misbehaves (legacy `Date` polyfills, broken RNG/clock on some Android devices). Since every SDK call funnels through `uuidv7()` via session/anonymous id generation, that throw previously crashed the host app; the v4 generator performs no field validation and never reads the clock, so id generation now degrades gracefully instead.
