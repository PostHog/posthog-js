---
'@posthog/ai': patch
---

fix(ai): declare `$ai_cache_reporting_exclusive: false` on OpenAI wrapper events so ingestion no longer double-bills cached input tokens for Claude models served through OpenAI-compatible hosts (e.g. OpenRouter)
