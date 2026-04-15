---
'@posthog/ai': minor
---

`Prompts.get()` now accepts `{ withMetadata: true }` and returns a `PromptResult` object containing `source` (`api`, `cache`, `stale_cache`, or `code_fallback`), `name`, and `version` alongside the prompt text. The previous plain-string return is deprecated and will be removed in a future major version.
