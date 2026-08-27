---
'@posthog/ai': minor
---

Report the tokens an interrupted stream actually used, instead of zero.

When a stream failed or was cancelled partway, the OpenAI wrapper discarded the token counts it had already accumulated and reported zero, so a call that consumed a large prompt appeared to cost nothing. It now reports what it collected, along with the real latency.

Token counts are also omitted entirely when the provider never reported them, rather than being sent as `$ai_input_tokens: 0`. This is a minor rather than a patch because `$ai_input_tokens` was previously always present on a generation event; anything reading it now needs to handle it being absent. Zero remains a valid value and still means the model consumed nothing.
