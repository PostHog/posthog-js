---
'@posthog/ai': patch
---

fix(gemini): declare Gemini's cache accounting model on generations with cache reads, so ingestion prices cached tokens from `$ai_cache_reporting_exclusive` instead of inferring it from the token counts
