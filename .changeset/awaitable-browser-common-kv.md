---
'@posthog/browser-common': patch
---

Add the shared extension runtime and `CoreExtension` capability contract, allow key-value stores to return values synchronously or asynchronously, and expose host API response details. Nullish values passed to `set` follow host-native storage semantics; use `remove` to delete a key.
