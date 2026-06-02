# `@posthog/mcp` — Architecture

This document describes the internals of the `@posthog/mcp` SDK and the exact PostHog event/property contract it emits.

## TL;DR

- `instrument(server, options)` wraps an MCP server, intercepts request handlers, and pushes structured events through a small in-memory pipeline into PostHog via `@posthog/core`.
- Every PostHog **event name** is `$`-prefixed (`$mcp_tool_call`, `$mcp_custom`, `$mcp_initialize`, …) per the PostHog naming convention for SDK-owned events.
- Every PostHog **property key** is also `$`-prefixed (`$mcp_tool_name`, `$mcp_intent`, `$mcp_duration_ms`, …) so MCP keys never collide with PostHog autocapture, web analytics, or other product events.
- `$session_id` ties one MCP connection to one PostHog session. `distinct_id` falls back through `identified user → session id → "anonymous"`.
- Tool calls can additionally emit `$ai_span` for the PostHog LLM analytics UI and `$exception` whenever a tool errors.

---

## 1. Wire-up

The public surface in `src/index.ts`:

- `instrument(server, options)` — installs the SDK on an MCP server. Idempotent per server (re-calling logs and returns early).
- `publishCustomEvent(server, eventData)` — emit an arbitrary `$mcp_custom` event onto the same pipeline. The server must already have been passed to `instrument()`.

The host application supplies its own `posthog-node` client via `options.posthog` (same pattern as `@posthog/ai`) and owns its lifecycle — there is no SDK-managed client to flush or shut down. Internally, `instrument()` wraps that client in an `McpEventSink` (`src/extensions/sink.ts`, not exported) that runs the pipeline and calls `posthog.capture()`.

`instrument()` does five things (`src/index.ts`):

1. Validate `server` is either a low-level `Server` or a high-level `McpServer`, and unwrap the latter to get the underlying `Server`.
2. Wrap the user-provided `options.posthog` client in an `McpEventSink`.
3. Build per-server tracking state (session id, identity cache, callbacks, the sink) stored in a module-level `WeakMap`.
4. Replace the `tools/call` and `initialize` handlers on the underlying `Server` instance with wrappers, and (for `McpServer`) install a `Proxy` on `_registeredTools` so any tool registered _after_ `instrument()` is also wrapped.
5. Optionally register the `get_more_tools` virtual tool when `options.reportMissing: true`.

Two implementations exist for the two MCP server shapes:

| Server type                              | File                       | Entry                       |
| ---------------------------------------- | -------------------------- | --------------------------- |
| Low-level `Server` (raw protocol SDK)    | `src/extensions/tracing.ts`   | `setupToolCallTracing()`    |
| High-level `McpServer` (typed wrapper)   | `src/extensions/tracing-v2.ts`| `setupTracking()`           |

Both converge on the same internal `UnredactedEvent` shape (`src/types.ts`) and the same publish pipeline.

## 2. Request lifecycle (tool call, high-level path)

```
client → MCP server → tools/call wrapper (tracing-v2.ts)
  ├─ initializeToolCallEvent      ← build UnredactedEvent, resolve session
  ├─ handleIdentify               ← fires $identify only if identity changed
  ├─ applyResolvedMetadata        ← runs eventProperties callback
  ├─ resolveToolCallIntent        ← context arg OR intentFallback callback
  ├─ originalHandler(request,extra)
  ├─ publishSuccessfulToolEvent   ← attaches result, duration
  └─ captureEvent(server, event)  → McpEventSink.capture()
```

The wrapper strips the `context` argument from `params.arguments` before forwarding to the user's tool callback, so tool implementations never see the analytics-only arg.

## 3. Event pipeline

Once an `UnredactedEvent` reaches `McpEventSink.capture()` (`src/extensions/sink.ts`), it runs through:

1. **Customer redaction** — `redactEvent(event, redactionFn)` if `options.redactSensitiveInformation` was set (`src/extensions/redaction.ts`). The redactor is called on every string in the event _except_ a protected field allowlist (`sessionId`, `id`, `server`, identify-\* fields, `resourceName`, `eventType`, `actorId`, `properties`).
2. **Sanitization** — `sanitizeEvent` (`src/extensions/sanitization.ts`):
   - `type: "image" | "audio"` content blocks → replaced with a text stub.
   - `type: "resource"` blocks with `.blob` → replaced.
   - Long base64-looking strings (≥10KB) → `"[binary data redacted...]"`.
   - Keys matching `SENSITIVE_KEY_PATTERN` (`authorization`, `cookie`, `password`, `token`, `secret`, `api_key`, `private_key`, …) → value replaced with `"[redacted]"`.
   - PostHog API-key patterns (`ph[a-z]_...`) in string values → `"[redacted]"`.
3. **Truncation** — `truncateEvent` (`src/extensions/truncation.ts`): per-field caps, recursive normalization (max depth 10, max breadth 100, max string 32KB), and a 100KB total event budget with progressive falloff.
4. **Build PostHog events** — `buildPostHogCaptureEvents` (`src/extensions/posthog-events.ts`) fans one internal event out to up to **3 PostHog events**:
   - Always: the main `$mcp_*` capture event.
   - If `event.isError && event.error`: a sibling `$exception` event.
   - If `enableAITracing && eventType === mcpToolsCall`: a sibling `$ai_span` event.
5. **Dispatch** — each event is handed to the user's `posthog-node` client via `posthog.capture()`. Batching, retries, and flushing are owned by that client. The host calls `posthog.shutdown()` to drain — the SDK installs no process-signal handlers and owns no client lifecycle.

## 4. Session & identity

- **Session ID format**: `ses_<uuidv7>` (`src/extensions/ids.ts`). Uses `uuidv7` from `@posthog/core`.
- **Session resolution order** (`src/extensions/session.ts`):
  1. If `extra.sessionId` (MCP protocol session) is present, derive a deterministic id by hashing it (`deterministicPrefixedId("ses", mcpSessionId)`). This means the same protocol session always maps to the same PostHog session across server restarts.
  2. If the MCP session id disappears mid-stream, keep using the last derived id (transient drops don't split sessions).
  3. Otherwise, generate `ses_<uuidv7>` and rotate after **30 minutes of inactivity** (`INACTIVITY_TIMEOUT_IN_MINUTES`).
- **`distinct_id`** (`posthog-events.ts`): `identifyActorGivenId || sessionId || "anonymous"`. Pre-identify events are session-scoped; once `options.identify()` returns a user, subsequent events attribute to that user and PostHog's standard identity merge takes over.
- **`$identify` event**: fires only when the identity returned by `options.identify()` _changes_ for a given session. There is a module-level LRU (max 1000 entries) keyed by session id (`src/extensions/internal.ts`), so an unchanged identity is silently deduped.
- **Person properties (`$set`)**: built from `UserIdentity.userName` (→ `name`) and any `userData` keys.

## 5. Event catalog

All events are emitted by `buildPostHogCaptureEvents`. The main event name is computed by looking up the internal `MCPAnalyticsEventType` in `BUILT_IN_EVENT_NAME_BY_TYPE`.

| PostHog event          | When                                                          | Notable extras                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$mcp_tool_call`       | Every tool invocation                                         | `$mcp_tool_name`, `$mcp_tool_description`, `$mcp_parameters`, `$mcp_response`, `$mcp_duration_ms`, `$mcp_is_error`, optionally `$mcp_intent` / `$mcp_intent_source`, AI trace refs if AI tracing on |
| `$mcp_tools_list`      | Client lists tools                                            | `$mcp_listed_tool_names` (array of tool names advertised); useful for "did this client discover us?" and "which advertised tools never get called?"                              |
| `$mcp_initialize`      | Client/server handshake                                       | `$mcp_client_name`, `$mcp_client_version`, `$mcp_server_name`, `$mcp_server_version`                                                                                            |
| `$mcp_resources_list`  | Client lists resources                                        | —                                                                                                                                                                               |
| `$mcp_resource_read`   | Resource fetched                                              | `$mcp_resource_name`, `$mcp_parameters`, `$mcp_response`                                                                                                                        |
| `$mcp_prompts_list`    | Client lists prompts                                          | —                                                                                                                                                                               |
| `$mcp_prompt_get`      | Prompt fetched                                                | `$mcp_resource_name` (= prompt name)                                                                                                                                            |
| `$mcp_custom`          | `publishCustomEvent()`                                        | Whatever the caller passed in `properties`                                                                                                                                      |
| `$identify`            | `options.identify` returned a new identity for the session    | `$set` populated                                                                                                                                                                |
| `$exception`           | Sibling to any errored event                                  | `$exception_list`, `$exception_level` (standard `@posthog/core` error-tracking shape)                                                                                           |
| `$ai_span`             | Sibling to `$mcp_tool_call` when `enableAITracing: true`      | Full `$ai_*` set — see §6                                                                                                                                                       |

## 6. Property catalog

All wire keys live in `PostHogMCPAnalyticsProperty` (`src/extensions/constants.ts`).

### Core properties (present on most `$mcp_*` events)

| Constant         | Wire key                  | Type                                  | Source                                                                                                                                                                                |
| ---------------- | ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionId`      | `$session_id`             | string                                | `event.sessionId` (`ses_…`)                                                                                                                                                           |
| `Source`         | `$mcp_source`             | string                                | Hardcoded `"posthog_mcp_analytics"`                                                                                                                                                   |
| `ResourceName`   | `$mcp_resource_name`      | string                                | Tool / resource / prompt name                                                                                                                                                         |
| `ToolName`       | `$mcp_tool_name`          | string                                | Same as `ResourceName`, but **only on `$mcp_tool_call`**                                                                                                                              |
| `ToolDescription`| `$mcp_tool_description`   | string                                | Tool's current `description` at call time. Cached from `tools/list` and (for `McpServer`) seeded from `_registeredTools`. Only on `$mcp_tool_call` and the paired `$exception` event |
| `ListedToolNames`| `$mcp_listed_tool_names`  | string[]                              | Names of tools advertised in a `tools/list` response. Only on `$mcp_tools_list` events.                                                                                               |
| `DurationMs`     | `$mcp_duration_ms`        | number (ms)                           | Wall-clock duration                                                                                                                                                                   |
| `IsError`        | `$mcp_is_error`           | boolean                               | Set from tool result or thrown exception                                                                                                                                              |
| `ServerName`     | `$mcp_server_name`        | string                                | `server._serverInfo.name`                                                                                                                                                             |
| `ServerVersion`  | `$mcp_server_version`     | string                                | `server._serverInfo.version`                                                                                                                                                          |
| `ClientName`     | `$mcp_client_name`        | string                                | `server.getClientVersion().name`                                                                                                                                                      |
| `ClientVersion`  | `$mcp_client_version`     | string                                | `server.getClientVersion().version`                                                                                                                                                   |
| `Intent`         | `$mcp_intent`             | string                                | `context` argument when present, else `intentFallback()` return                                                                                                                       |
| `IntentSource`   | `$mcp_intent_source`      | `"context_parameter" \| "inferred"`   | Where the intent came from                                                                                                                                                            |
| `ConversationId` | `$mcp_conversation_id`    | string                                | Optional; only set when `enableConversationId: true`                                                                                                                                  |
| `Parameters`     | `$mcp_parameters`         | object                                | Sanitized MCP request payload (see §3)                                                                                                                                                |
| `Response`       | `$mcp_response`           | object                                | Sanitized tool result                                                                                                                                                                 |

### Person properties (`$set`)

| Key           | Source                                |
| ------------- | ------------------------------------- |
| `name`        | `UserIdentity.userName`               |
| `<anything>`  | Top-level keys of `UserIdentity.userData` |

### AI tracing properties (`$ai_span` event + duplicated on `$mcp_tool_call`)

| Constant       | Wire key             | Type                  | Notes                                                          |
| -------------- | -------------------- | --------------------- | -------------------------------------------------------------- |
| `AiSessionId`  | `$ai_session_id`     | string                | `posthog_mcp_analytics_${sessionId}` — namespaced               |
| `AiTraceId`    | `$ai_trace_id`       | string                | `event.sessionId` — all tool calls in a session share this     |
| `AiSpanId`     | `$ai_span_id`        | string                | `event.id` — unique per tool call (`evt_…`)                    |
| `AiSpanName`   | `$ai_span_name`      | string                | Tool name                                                      |
| `AiIsError`    | `$ai_is_error`       | boolean               | —                                                              |
| `AiLatency`    | `$ai_latency`        | number (**seconds**)  | `duration_ms / 1000` — different unit from `$mcp_duration_ms`  |
| `AiInputState` | `$ai_input_state`    | object                | Same content as `$mcp_parameters`                              |
| `AiOutputState`| `$ai_output_state`   | object                | Same content as `$mcp_response`                                |
| `$ai_error`    | `$ai_error`          | object                | Set as a literal property, not via the constants enum          |

`$ai_trace_id` and `$ai_span_id` are also stamped onto the main `$mcp_tool_call` event so the two events can be joined.

### Exception properties (`$exception` event)

`$exception_list` + `$exception_level` (the standard `@posthog/core` error-tracking shape — each exception carries `type`, `value`, `mechanism`, and a parsed `stacktrace.frames`), plus `$session_id`, `$mcp_resource_name`, `$mcp_tool_name` and `$mcp_tool_description` (tool calls only), `$mcp_server_*`, `$mcp_client_*`.

### Customer-defined properties

The `eventProperties` callback returns key/value pairs that are **spread flat at the top level of the PostHog event properties**, alongside the `$mcp_*` keys. They can therefore override built-in `$mcp_*` keys — intentional, so customers can backfill missing context. Values must be JSON-serializable; the SDK does not validate keys or values beyond truncation.

## 7. Customer extension points (`MCPAnalyticsOptions`, `src/types.ts`)

| Option                       | Default                                   | Use case                                                                                                                                |
| ---------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `posthog`                    | —                                         | A `posthog-node` client you construct and own (host, project token, batching, lifecycle all configured there). Without it, no events are sent. |
| `logger`                     | no-op                                     | STDIO-safe log sink for SDK-internal warnings. Receives single string messages.                                                         |
| `enableTracing`              | `true`                                    | Master kill switch for event emission.                                                                                                  |
| `enableAITracing`            | `false`                                   | Emit `$ai_span` so MCP activity shows up in PostHog LLM analytics.                                                                      |
| `enableConversationId`       | `false`                                   | Inject the `conversation_id` parameter into every tool and stamp `$mcp_conversation_id` on events.                                      |
| `reportMissing`              | `false`                                   | Register the `get_more_tools` virtual tool.                                                                                             |
| `context`                    | `true` (object form: `{ description }`)   | Inject required `context` arg into every tool schema.                                                                                   |
| `intentFallback`             | —                                         | Consumer-supplied callback returning a `$mcp_intent` string when the client didn't pass a `context` argument. SDK does no inference.    |
| `identify`                   | —                                         | Async function returning `UserIdentity \| null`.                                                                                        |
| `redactSensitiveInformation` | —                                         | Async string-level redactor. Runs before sanitization.                                                                                  |
| `eventProperties`            | —                                         | Freeform JSON, spread flat.                                                                                                             |

## 8. Useful queries

All queries assume `event` is the PostHog event name column. Property names use the literal wire keys (with `$`).

### Top tools per server (last 7d)

```sql
SELECT
  properties.$mcp_server_name AS server,
  properties.$mcp_tool_name   AS tool,
  count() AS calls
FROM events
WHERE event = '$mcp_tool_call' AND timestamp > now() - INTERVAL 7 DAY
GROUP BY server, tool
ORDER BY calls DESC
LIMIT 50
```

### Error rate per tool

```sql
SELECT
  properties.$mcp_tool_name AS tool,
  countIf(properties.$mcp_is_error)        AS errors,
  count()                                  AS total,
  countIf(properties.$mcp_is_error) / count() AS error_rate
FROM events
WHERE event = '$mcp_tool_call' AND timestamp > now() - INTERVAL 7 DAY
GROUP BY tool
ORDER BY total DESC
```

### P95 latency per tool

```sql
SELECT
  properties.$mcp_tool_name AS tool,
  quantile(0.95)(toFloat(properties.$mcp_duration_ms)) AS p95_ms
FROM events
WHERE event = '$mcp_tool_call' AND timestamp > now() - INTERVAL 7 DAY
GROUP BY tool
ORDER BY p95_ms DESC
```

### Intent samples split by source

```sql
SELECT
  properties.$mcp_intent_source AS source,
  properties.$mcp_tool_name     AS tool,
  any(properties.$mcp_intent)   AS sample_intent,
  count()                       AS calls
FROM events
WHERE event = '$mcp_tool_call' AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY source, tool
ORDER BY calls DESC
```

### Joining `$mcp_tool_call` to its `$ai_span` sibling

```sql
SELECT
  c.properties.$mcp_tool_name    AS tool,
  c.properties.$mcp_duration_ms  AS duration_ms,
  s.properties.$ai_latency       AS ai_latency_s,
  c.properties.$mcp_intent       AS intent
FROM events c
INNER JOIN events s
  ON s.event = '$ai_span'
 AND s.properties.$ai_span_id = c.properties.$ai_span_id
WHERE c.event = '$mcp_tool_call'
  AND c.timestamp > now() - INTERVAL 24 HOUR
LIMIT 100
```

### Advertised tools that never get called

```sql
WITH listed AS (
  SELECT DISTINCT arrayJoin(properties.$mcp_listed_tool_names) AS tool_name
  FROM events
  WHERE event = '$mcp_tools_list'
    AND timestamp > now() - INTERVAL 30 DAY
),
called AS (
  SELECT DISTINCT properties.$mcp_tool_name AS tool_name
  FROM events
  WHERE event = '$mcp_tool_call'
    AND timestamp > now() - INTERVAL 30 DAY
)
SELECT tool_name AS zombie_tool
FROM listed
WHERE tool_name NOT IN (SELECT tool_name FROM called)
ORDER BY tool_name
```

### Active sessions per client

```sql
SELECT
  properties.$mcp_client_name AS client,
  uniq(properties.$session_id) AS sessions
FROM events
WHERE event IN ('$mcp_initialize', '$mcp_tool_call')
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY client
ORDER BY sessions DESC
```

## 9. Migration from the previous standalone `@posthog/mcp` (0.0.x)

The previous version of this SDK lived in a separate repo and depended on `posthog-node`. This first monorepo release (`0.1.0`) is a clean break — there were no production users, so the contract is intentionally rebuilt rather than maintained.

### Breaking changes

| Concern                                | Old (standalone 0.0.x)                                          | New (monorepo 0.1.0)                                                                  |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| PostHog client                         | Required `posthog-node` runtime dep, or BYO via `posthogClient` | BYO `posthog-node` client via the `posthog` option (matches `@posthog/ai`)            |
| `posthogClient` option                 | Accepted any duck-typed client                                  | Renamed to `posthog`; expects a `posthog-node` `PostHog` instance                     |
| `posthogOptions` option                | Forwarded to `posthog-node`                                     | Removed — configure the `posthog-node` client you pass in directly                    |
| `eventTags` callback                   | Constrained string map; spread flat on events                   | Removed — fold all metadata into `eventProperties`                                    |
| `~/posthog-mcp-analytics.log`          | SDK wrote to the user's home directory                          | Removed; pass `logger?: (msg: string) => void` if you want to capture internal logs   |
| PostHog event names                    | Plain (`mcp_tool_call`, `mcp_custom`, `posthog_identify`, …)    | `$`-prefixed (`$mcp_tool_call`, `$mcp_custom`, `$identify`, …) per PostHog convention |
| `POSTHOG_MCP_ANALYTICS_HOST` env var   | Read at `instrument()` time                                          | Removed; pass `host` directly                                                         |
| Session id source                      | `uuidv4` via `node:crypto`                                      | `uuidv7` from `@posthog/core`                                                         |

### Insight migration checklist

1. `event = 'mcp_tool_call'` → `event = '$mcp_tool_call'` (same for every other `mcp_*` event).
2. `event = 'posthog_identify'` → `event = '$identify'`.
3. Replace `properties.$mcp_source = 'posthog_mcp_analytics'` filters with `event LIKE '$mcp_%'` if you want a broader funnel.
4. Drop any filters on customer tags — fold them into `eventProperties`.

## 10. Intent resolution in depth

Intent is the most semantically-loaded property the SDK emits. Lives in `src/extensions/intent.ts`.

### Two sources, one property

`$mcp_intent` can come from either:

1. **The `context` argument the LLM/client passed** — the SDK-injected JSON-Schema parameter. Tagged `$mcp_intent_source = "context_parameter"`.
2. **The `intentFallback` callback you supplied** — runs only when no `context` argument is present. Tagged `$mcp_intent_source = "inferred"`.

Explicit context always wins. If `context` is non-empty, `intentFallback` is **not invoked**.

### Why the fallback exists

The `context` parameter is advertised as required in JSON Schema but **not enforced at the SDK validation layer** — a tool call with `arguments: {}` succeeds and lands in PostHog with `$mcp_intent` empty.

The MCP SDK validates against the Zod schema the tool was originally registered with, and `@posthog/mcp` does not (and can't safely) re-derive Zod from the mutated JSON Schema. So for clients that ignore the JSON Schema hint — raw cURL, in-house agents, schema-blind crawlers — `intentFallback` is the only way to keep intent coverage non-zero.

For a tightly-controlled internal MCP server with a single well-behaved client, the fallback is dead code.

### What the SDK does NOT do

`intentFallback` is **a slot**, not a strategy. The SDK:

- Awaits whatever async function you pass.
- Trims and null-guards the result.
- Tags it `source: "inferred"`.
- Swallows + logs any thrown exception.

The SDK does **not**: call an LLM, inspect tool arguments, build heuristics, or cache results across calls. If you want any of that, your callback implements it.

### Recommended `intentFallback` patterns

1. **Deterministic, per-tool** (cheapest, sync, runs on every uncontextualized call):

   ```ts
   intentFallback: (request) => {
     const tool = request.params?.name
     const args = request.params?.arguments ?? {}
     if (tool === 'search_events') return `Searching events for "${args.query}"`
     return tool ? `Invoking ${tool}` : null
   }
   ```

2. **Transport metadata** (when `extra` carries user-agent or session info worth surfacing):

   ```ts
   intentFallback: (request, extra) => {
     const ua = extra?.requestInfo?.headers?.['user-agent']
     return `${ua ?? 'unknown client'} invoked ${request.params?.name}`
   }
   ```

3. **LLM-derived** (async, expensive — push back unless the value is high). Sits on the hot path of every uncontextualized tool call.

### Known sharp edges

- The `get_more_tools` virtual tool always reports `$mcp_intent_source = "context_parameter"`. It's defensible — the LLM did type a context string — but worth knowing if you segment by source.
- `$mcp_intent_source` is currently **only** present when an intent was captured. Events with neither a context arg nor a fallback result have no `$mcp_intent` and no `$mcp_intent_source`. Dashboards filtering on `$mcp_intent_source = "inferred"` won't see them — that's the desired behavior; just don't expect a synthetic `"none"` value.

---

## File map quick reference

| Concern                                          | File                                                       |
| ------------------------------------------------ | ---------------------------------------------------------- |
| Public API entry                                 | `src/index.ts`                                             |
| Public types & options                           | `src/types.ts`                                             |
| Property/event constants                         | `src/extensions/constants.ts`                                 |
| Event serialization to PostHog                   | `src/extensions/posthog-events.ts`                            |
| Internal event types                             | `src/extensions/event-types.ts`                               |
| `McpEventSink` (wraps posthog-node) + pipeline   | `src/extensions/sink.ts`                                      |
| Per-server `captureEvent` helper                 | `src/extensions/capture.ts`                                  |
| High-level `McpServer` wrapping                  | `src/extensions/tracing-v2.ts`                                |
| Low-level `Server` wrapping                      | `src/extensions/tracing.ts`                                   |
| Intent resolution (context arg + fallback)       | `src/extensions/intent.ts`                                    |
| Identity cache + identify dispatch               | `src/extensions/internal.ts`                                  |
| Session id derivation & timeout                  | `src/extensions/session.ts`, `src/extensions/ids.ts`             |
| `conversation_id` injection + minting            | `src/extensions/conversation-id.ts`                           |
| `get_more_tools` virtual tool                    | `src/extensions/tools.ts`                                     |
| Customer redaction                               | `src/extensions/redaction.ts`                                 |
| Auto-redaction & binary stubbing                 | `src/extensions/sanitization.ts`, `src/extensions/mcp-payloads.ts` |
| Size / depth / breadth caps                      | `src/extensions/truncation.ts`                                |
| `context` JSON-Schema injection                  | `src/extensions/context-parameters.ts`                        |
| STDIO-safe logger sink                           | `src/extensions/logger.ts`                                    |
| Exception capture & stack-trace parsing          | `src/extensions/exceptions.ts`                                |
| MCP SDK version compat shims                     | `src/extensions/compatibility.ts`, `src/extensions/mcp-sdk-compat.ts` |
