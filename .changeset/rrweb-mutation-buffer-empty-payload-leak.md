---
'@posthog/rrweb': patch
---

Fix a memory leak in Session Replay recording: `MutationBuffer` skipped its own cleanup whenever a mutation batch normalized to an empty payload (e.g. a node added and removed within the same task), leaving the buffer holding strong references to DOM nodes indefinitely.
