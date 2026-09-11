---
'@posthog/mcp': patch
---

Harden the send_feedback tool: a declared `integer` extra now rejects fractional numbers, a thrown `onFeedback` handler logs only the exception type (its message can echo agent-controlled report text), and `prepareToolCall` treats a supplied `originalTool` as proof a real application tool owns the feedback name so the real tool is dispatched instead of being flagged as feedback.
