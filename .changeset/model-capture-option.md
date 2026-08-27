---
'@posthog/mcp': minor
---

Add opt-in `captureModel` option: injects a required `llm_model` parameter into every tool — including the `get_more_tools` virtual tool — so the calling agent self-reports the model it runs as, captured as `$mcp_llm_model` with `$mcp_llm_model_source = "self_reported"`. Stripping the argument before the handler runs and capturing the property both require confirmed SDK ownership of the parameter: a customer-declared `llm_model` is never stolen or captured, and a low-level `Server` that builds a fresh instance per request records nothing (see the README). An honest `"unknown"` from the agent is dropped rather than recorded.
