---
'@posthog/ai': patch
---

OpenAI Agents `instrument()` now passes `onError` to the tracing processor it registers. It was accepted but ignored, so processor failures stayed silent.
