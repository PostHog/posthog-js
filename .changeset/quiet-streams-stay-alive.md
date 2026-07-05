---
'@posthog/ai': patch
---

fix: prevent unhandled promise rejection from crashing the host process when a streamed provider response errors mid-flight (OpenAI, Azure OpenAI, Anthropic wrappers)
