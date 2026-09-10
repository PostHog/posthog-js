# ADR-0012: One `send_feedback` virtual tool, one `$mcp_feedback` event

- Status: Accepted
- Date: 2026-09-09

## Context

Server owners need a generic way to collect feedback from agents. An agent experiences the whole session — every tool call, every retry, every moment of confusion — and that perspective never reaches the server owner: a capability gap produces no tool call at all, a confusing schema produces a workaround, and a helpful tool produces silence. The SDK's only feedback affordance was the `get_more_tools` virtual tool (ADR-0002), which covers exactly one category (missing capabilities) and whose name promises tool retrieval it does not deliver.

The MCP spec offers no feedback primitive (2026-07-28 core: logging, `isError`, OTel trace context; an opt-in feedback capability is only community proposal modelcontextprotocol#2369), so a tool call remains the only agent-initiated channel.

## Decision

Add a **new** `send_feedback` virtual tool behind a **new** `collectFeedback` option, emitting a **new** `$mcp_feedback` event. `reportMissing` / `get_more_tools` / `$mcp_missing_capability` stay exactly as they are — existing consumers depend on them.

1. **One tool, honest strings.** `feedback_type` (`missing_capability` | `issue` | `praise` | `other`) routes the report; missing capabilities are the priority category, stated plainly in the description ("report a missing capability whenever no available tool fits your task, even if you can work around it"). The description and the acknowledgement both say the tool records feedback and adds no tools.
2. **One event.** Every call emits `$mcp_feedback` with `$mcp_feedback_type` as a property. Split routing (missing-capability reports into the existing `$mcp_missing_capability`) was rejected: one tool emitting two events is surprising, "all feedback" queries must union anyway, agent misclassification would contaminate the flagship event, and property filters give the same query power. `$mcp_missing_capability` remains exclusively the `get_more_tools` event.
3. **Host-extensible schema.** `extraProperties` merges plain JSON-Schema fragments into the advertised input schema; declared extras are captured as `$mcp_feedback_<key>` through the standard sanitize/bound pipeline, undeclared arguments reach only the handler's `raw`. Reserved keys (core fields, `type`/`tool` whose prefixed property would collide, SDK-injected arguments) fail at configuration time.
4. **A real backend is a handler away.** By default the tool is virtual (analytics event + acknowledgement). On the `instrument()` path, `onFeedback` routes reports to the host's own backend and can replace the reply. On the custom-dispatcher path the host is the handler: `prepareToolCall().isFeedback` / `feedbackReport`, `captureFeedback()`, `sendFeedbackResult()`.
5. **Same virtual-tool mechanics as ADR-0002.** Appended via `tools/list`, detected by resolved name + not-advertised-by-the-app, fail-open on real-tool name collisions, ownership resolved statically for stateless instances, `llm_model` / `conversation_id` interplay unchanged, and the global `context` parameter is not injected (the report's summary/details carry the intent).

## Consequences

- Free-text feedback fields are agent-narrated, so they get the `$mcp_intent` treatment (sanitize, structured-PII redaction, length bound) before capture; `event.properties` bypasses the event-level pipeline, so this happens at build time in `feedback.ts`.
- `send_feedback` covers what `reportMissing` covers. New integrations should enable only `collectFeedback`; consumers of `$mcp_missing_capability` see only `get_more_tools` reports and must additionally read `$mcp_feedback` with `$mcp_feedback_type = "missing_capability"` once servers adopt the new tool.
- Dashboards must treat `$mcp_feedback` separately from `$mcp_tool_call`, the same rule ADR-0002 set for `$mcp_missing_capability`.
- A later revisit of `get_more_tools` (or its deprecation) is deliberately out of scope here.

## References

- ADR-0002 (tools/list analytics affordances)
- modelcontextprotocol/modelcontextprotocol discussion #2369 (opt-in client-experience feedback proposal)
