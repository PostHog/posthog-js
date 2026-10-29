---
'@posthog/ai': patch
---

Capture an `$ai_generation` error event when an OpenAI, Azure OpenAI or Anthropic call with `stream: true` fails before the stream opens (for example a 401, 429 or invalid model). Before, only the non-streaming call captured those errors.
