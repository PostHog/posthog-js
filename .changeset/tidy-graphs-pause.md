---
'@posthog/ai': patch
---

Treat LangGraph `GraphInterrupt` and `NodeInterrupt` control-flow exceptions as non-error trace and span completions in the LangChain callback.
