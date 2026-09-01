---
'@posthog/ai': patch
---

Capture `$ai_stop_reason` from LangChain runs that use the OpenAI Responses API.

The callback only understood Chat Completions vocabulary (`finish_reason` / `stop_reason`), so Responses API runs, which report `status` and `incomplete_details.reason` instead, never carried a stop reason. The Chat Completions keys keep priority, and `incomplete_details.reason` outranks `status`, so an early stop names its cause (for example `max_output_tokens`) instead of just `incomplete`.
