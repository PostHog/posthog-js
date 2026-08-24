---
'@posthog/core': patch
---

Stop crashing when the environment's `Math.random()` misbehaves. The vendored UUIDv7 generator builds its random fields from a `Math.random()`-based `nextUint32()`, and a nonconformant implementation that returns a value of 1 or greater, or NaN, pushed those fields out of range, so `fromFieldsV7` threw `RangeError: invalid field value` on every event captured. On React Native this is not hypothetical: Hermes implements `Math.random` with C++ `std::uniform_real_distribution`, which is documented to occasionally return its upper bound, and affected Android devices crash-looped on startup during the SDK's internal event-queue flush — a path applications cannot wrap in a try/catch. `nextUint32()` now clamps its result to a valid unsigned 32-bit integer (`>>> 0`), so a bad random value degrades UUID entropy for that id instead of taking the app down; the timestamp bits are untouched and generated ids remain spec-valid UUIDv7.
