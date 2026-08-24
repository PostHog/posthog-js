---
'@posthog/mcp': minor
---

Add opt-in `captureModel` option: injects a required `llm_model` parameter into every tool so the calling agent self-reports the model it runs as, captured as `$mcp_llm_model` with `$mcp_llm_model_source = "self_reported"`. The argument is stripped before the tool handler runs, a customer-declared `llm_model` parameter is never stolen or captured, and an honest `"unknown"` from the agent is dropped rather than recorded.
