---
'@posthog/ai': patch
---

Interrupted or cancelled streams now report the token usage and latency they actually observed, instead of zeros, across the OpenAI, Anthropic, Gemini, Azure and Vercel wrappers. When usage was never reported, token counts and override costs are omitted entirely, so `$ai_input_tokens` can be absent where it was previously always `0`.
