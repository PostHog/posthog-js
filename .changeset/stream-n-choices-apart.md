---
'@posthog/ai': patch
---

Keep the choices of an `n > 1` streamed OpenAI chat completion apart in `$ai_output_choices`, one message per choice as non-streamed calls already do, and take `$ai_stop_reason` from the first choice.
