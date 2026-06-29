---
'posthog-node': minor
---

Add `groupIdentifyImmediate()` to await the network request when identifying a group, mirroring `captureImmediate`/`identifyImmediate`/`aliasImmediate`. Useful in edge/serverless environments where the background queue may not flush.
