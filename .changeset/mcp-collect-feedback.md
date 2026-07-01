---
'@posthog/mcp': minor
---

Add a `collectFeedback` option that registers a `submit_feedback` virtual tool (mirroring `reportMissing`/`get_more_tools`). When enabled, agents can send structured feedback about the server or the product it exposes; calls are captured as a `$mcp_feedback` event with the fields spread as `$mcp_`-prefixed properties (`$mcp_feedback_type`, `$mcp_sentiment`, `$mcp_summary`, …). Rename the tool via `feedbackToolName`. The `PostHogMCP` custom-dispatcher path gains the matching `prepareToolList({ collectFeedback })`, `prepareToolCall().isFeedback`, and `captureFeedback()`, plus a `getFeedbackResult()` export.
