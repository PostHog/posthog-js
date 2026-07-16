---
'@posthog/ai': patch
---

Fix Vercel AI SDK reasoning text being dropped from `$ai_input`. The input mapper read reasoning content from `c.reasoning`, but AI SDK reasoning prompt parts store their content in `text`, so prior-turn thinking blocks were captured as empty. It now reads `c.text` (falling back to `c.reasoning`), matching the output mapper.
