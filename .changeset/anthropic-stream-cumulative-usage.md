---
'@posthog/ai': patch
---

fix: Use the cumulative input and cache token counts from Anthropic's final `message_delta` when streaming with server tools.
