---
'@posthog/ai': patch
---

Report the tokens an interrupted stream actually used, instead of zero.

When a stream failed or was cancelled partway, the wrappers discarded the token counts they had already accumulated and reported zero, so a call that consumed a large prompt appeared to cost nothing. They now report what they collected, along with the real latency. This covers the OpenAI chat, Responses and transcription streams, and the Anthropic, Gemini, Azure and Vercel wrappers.

Token counts are also omitted entirely when the provider never reported them, rather than being sent as `$ai_input_tokens: 0`. Zero remains a valid value and still means the model consumed nothing. The package API does not change, but `$ai_input_tokens` was previously always present on a generation event, so anything reading that property downstream needs to handle it being absent.

Cost overrides follow the same rule: a configured price is applied only to the token counts the provider reported, so an interrupted stream no longer claims a `$0` cost just because a `costOverride` was set.
