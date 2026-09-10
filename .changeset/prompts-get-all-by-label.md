---
'@posthog/ai': minor
---

`prompts.getAll({ label: 'production' })` fetches every prompt that carries a label in one request and stores them in the prompt cache, so later `get(name, { label })` calls are cache hits. Apps with many prompts no longer need one request per prompt per cache cycle. Against a PostHog server that does not support labels on the prompt list endpoint yet, the call fails with a clear error instead of caching wrong versions.
