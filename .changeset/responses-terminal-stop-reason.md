---
'@posthog/ai': patch
---

Only terminal Responses API statuses become `$ai_stop_reason` (a queued or in-progress background run no longer records a lifecycle state as its stop reason), and the native OpenAI wrapper now names a truncated run by `incomplete_details.reason` (e.g. `max_output_tokens`) instead of the bare `incomplete`, matching the LangChain callback
