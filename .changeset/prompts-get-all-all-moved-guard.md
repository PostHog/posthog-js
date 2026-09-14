---
'@posthog/ai': patch
---

Fix `prompts.getAll` returning an empty result instead of an error on PostHog servers that do not support fetching prompts by label.
