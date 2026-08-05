---
'@posthog/ai': patch
---

Capture the reasoning text of assistant turns replayed in a Vercel AI SDK prompt. The input mapper read a non-existent `reasoning` field instead of the spec's `text`, so `$ai_input` reasoning parts arrived empty for multi-step agentic loops.
