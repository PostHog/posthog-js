---
'@posthog/ai': patch
---

Treat LangGraph control-flow exceptions (`GraphInterrupt`, `NodeInterrupt`, `ParentCommand`, and other `is_bubble_up` errors) as non-error trace and span completions in the LangChain callback, surfacing pending interrupts as `$ai_output_state` under the `__interrupt__` key.
