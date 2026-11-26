---
'@posthog/ai': patch
---

Gemini `generateContentStream` now captures image and other inline data output parts in `$ai_output_choices`, formatted and redacted like `generateContent`, and an inline data chunk sets `$ai_time_to_first_token`.
