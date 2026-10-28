---
'@posthog/browser': patch
---

fix: settle pending `captureImmediate()` calls when the client shuts down before lazy analytics delivery loads
