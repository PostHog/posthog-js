---
'@posthog/ai': patch
---

Report cache-write tokens for the OpenAI wrapper. OpenAI-compatible providers (e.g. Claude via OpenRouter) and OpenAI itself on newer models return `usage.prompt_tokens_details.cache_write_tokens` alongside `cached_tokens`, but the wrapper only surfaced cache reads. It now populates `$ai_cache_creation_input_tokens` for both streaming and non-streaming Chat Completions, so ingestion can bill the cache-write premium instead of under-reporting cost on cache-heavy calls. Completes the cache-aware cost fix started in #4071 (#3615).
