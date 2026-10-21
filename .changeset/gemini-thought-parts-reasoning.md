---
'@posthog/ai': patch
---

fix: Capture Gemini thought summaries (`thinkingConfig.includeThoughts`) as `reasoning` content blocks instead of answer text, in responses, streamed output, replayed input and the ADK plugin.
