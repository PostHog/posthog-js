---
'@posthog/mcp': patch
---

fix(mcp): keep `additionalProperties: false` on tool schemas when injecting `context`, `llm_model` and `conversation_id`. The injected keys are declared properties, so the schema stays valid and keeps the strictness the host advertised.
