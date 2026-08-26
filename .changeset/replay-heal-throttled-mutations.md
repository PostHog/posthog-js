---
'@posthog/core': patch
'posthog-js': patch
'posthog-node': patch
---

Heal session recordings when the mutation throttler drops an attribute change. The recorder now counts dropped attribute mutations, takes a debounced full snapshot to re-sync the player's mirror, and reports the count as `$sdk_debug_replay_throttled_mutations_dropped` so the path is measurable. Also fixes `BucketedRateLimiter` off-by-one, which rate limited one request more than the bucket size.
