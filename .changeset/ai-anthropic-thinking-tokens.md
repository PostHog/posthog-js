---
'@posthog/ai': patch
---

Report `$ai_reasoning_tokens` for Anthropic calls from `usage.output_tokens_details.thinking_tokens`, in the wrapper (streaming and non-streaming) and in the Claude Agent SDK processor.
