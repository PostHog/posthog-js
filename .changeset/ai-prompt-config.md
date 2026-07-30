---
'@posthog/ai': minor
---

`Prompts.get()` results now include `config`, the JSON object of model parameters or agent configuration stored with the prompt version in PostHog prompt management (`null` when the version has none). Config is carried through the client-side cache and the stale-cache fallback, and each result gets its own copy so mutating `result.config` cannot pollute later cache hits. The hardcoded `fallback` string has no config, so use defensive access like `(result.config ?? {}).temperature`.
