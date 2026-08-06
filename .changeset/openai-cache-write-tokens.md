---
'@posthog/ai': patch
---

Report cache-write tokens for the OpenAI wrapper. OpenAI-compatible providers that follow Anthropic's cache-write convention (e.g. Claude via OpenRouter) return cache-write tokens in the response usage (`prompt_tokens_details.cache_write_tokens` for Chat Completions, `input_tokens_details.cache_write_tokens` for Responses), but the wrapper only surfaced cache reads. It now populates `$ai_cache_creation_input_tokens` across Chat Completions and Responses (streaming, non-streaming, and `parse()`), so ingestion can price the cache-write premium for Claude/Anthropic models instead of under-reporting cost on cache-heavy calls. Completes the cache-aware cost fix started in #4071 (#3615).
