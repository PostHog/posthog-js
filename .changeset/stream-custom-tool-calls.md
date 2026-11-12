---
'@posthog/ai': patch
---

Streamed OpenAI chat completions now keep custom tool calls in `$ai_output_choices`, the same way non-streaming completions do.
