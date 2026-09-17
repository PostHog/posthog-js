---
'@posthog/ai': minor
---

`prompts.getAll()` now works without a label. It fetches the latest version of every prompt in one request and warms the cache for plain `prompts.get(name)` calls. Previously the label was required by the method's type, and the server treats any label value as a filter, so there was no way to batch-fetch unlabeled prompts.
