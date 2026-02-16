---
'@posthog/ai': patch
---

Bind prompt fetches to both credentials by requiring `projectApiKey` and adding `token=<projectApiKey>` to prompt API reads.
