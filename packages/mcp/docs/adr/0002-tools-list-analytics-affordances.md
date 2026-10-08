# ADR-0002: Analytics affordances are injected via `tools/list`

- Status: Accepted
- Date: 2026-08-06 (backfilled; decisions shipped 2026-02 through 2026-05)

## Context

The differentiator of MCP analytics is **intent** — not "ran `query_run` 14 times" but "was trying to find a churn cohort". The agent is the only party that knows its intent, and the only channel the SDK controls to ask for it is the tool schemas the server advertises. Separately, we want to learn about capabilities agents *looked for but didn't find*, which by definition never show up as tool calls.

## Decision

The SDK decorates every `tools/list` response it intercepts:

1. **`context` parameter** — injected into each tool's input JSON Schema, advertised as required, with a description telling the agent to state what it is trying to accomplish. Captured as `$mcp_intent` (`$mcp_intent_source: "context_parameter"`) and stripped from the arguments before the tool's own validation runs.
2. **`get_more_tools` virtual tool** — appended when `reportMissing` is on. Calls to it emit `$mcp_missing_capability` (a capability gap, not a tool invocation), with the agent's description as `$mcp_intent`. The name resolves through a single helper so injection and detection can't drift, and if a real tool already uses the name, the SDK warns and delegates to the real handler (fail open) rather than intercepting it.

Two deliberate limits:

- **Schema mutation is conservative.** Tools whose schema already declares the parameter, or is composed (`oneOf`/`allOf`/`anyOf`/`$ref`), are skipped with a warning — there is no single `properties` bag to extend safely. `additionalProperties: false` is lifted only on schemas we do extend, since the injected key would otherwise invalidate them.
- **"Required" is advisory.** The MCP SDK validates calls against the Zod schema the tool was registered with, and the SDK cannot safely re-derive Zod from the mutated JSON Schema — so a call without `context` still succeeds, just without intent. The `intentFallback` option exists for exactly those clients (tagged `$mcp_intent_source: "inferred"`); the SDK deliberately does no inference itself.

## Consequences

- Intent coverage depends on agent compliance; schema-blind clients need `intentFallback` or produce events with no `$mcp_intent` at all (and no synthetic `"none"` value).
- Every injected affordance must be stripped on the inbound path (arguments cleaned before dispatch), which is why argument "ownership" is tracked per tool from the advertised listing.
- The virtual tool means dashboards must treat `$mcp_missing_capability` separately from `$mcp_tool_call` — it is deliberately not a tool invocation.

## References

- PostHog/posthog-js#3653 (initial SDK), #3976 / #3993 (late handler registration), #4356 (preserve real tools named `get_more_tools`), #4379 (reserved-argument ownership)
