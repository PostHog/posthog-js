---
'@posthog/core': minor
'posthog-node': minor
'@posthog/convex': patch
---

Add `groupIdentifyImmediate()` to await the network request when identifying a group, mirroring `captureImmediate`/`identifyImmediate`/`aliasImmediate`. Useful in edge/serverless environments where the background queue may not flush. The Convex integration now uses it directly instead of routing `$groupidentify` through `captureImmediate`.
