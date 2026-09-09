---
'@posthog/mcp': minor
---

Add the `send_feedback` virtual tool (new `collectFeedback` option): an honest, general agent-feedback channel with missing capabilities as the priority category. Every call emits a new `$mcp_feedback` event with `$mcp_feedback_type` and the other `$mcp_feedback_*` properties. Hosts can rename the tool, replace its description, declare `extraProperties` (captured as `$mcp_feedback_<key>`), and route reports to a real backend via `onFeedback` (`instrument()` path) or `prepareToolCall().feedbackReport` + `captureAgentFeedback()` + `agentFeedbackResult()` (custom-dispatcher path). `reportMissing` / `get_more_tools` / `$mcp_missing_capability` are unchanged; new integrations should enable only `collectFeedback`.
