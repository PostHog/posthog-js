---
'@posthog/ai': patch
---

Stop counting Google Search retrieval tokens as Gemini input tokens, which Google does not bill; tokens from URL context, Code Execution and File Search still count.
