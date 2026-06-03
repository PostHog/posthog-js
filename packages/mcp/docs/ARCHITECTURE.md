# `@posthog/mcp` — Architecture

This document describes the internals of the `@posthog/mcp` SDK and the exact PostHog event/property contract it emits.

## TL;DR

- `instrument(server, options)` wraps an MCP server, intercepts request handlers, and pushes structured events through a small in-memory pipeline into PostHog via the host's `posthog-node` client (`posthog.capture()`).
- Every PostHog **event name** is `$`-prefixed (`$mcp_tool_call`, `$mcp_custom`, `$mcp_initialize`, …) per the PostHog naming convention for SDK-owned events.
- Every PostHog **property key** is also `$`-prefixed (`$mcp_tool_name`, `$mcp_intent`, `$mcp_duration_ms`, …) so MCP keys never collide with PostHog autocapture, web analytics, or other product events.
- `$session_id` ties one MCP connection to one PostHog session. `distinct_id` falls back through `identified user → session id → "anonymous"`.
- Tool calls additionally emit a sibling `$exception` event whenever a tool errors (unless `enableExceptionAutocapture: false`).

---

## 1. Wire-up

The public surface in `src/index.ts`:

- `instrument(server, options)` — installs the SDK on an MCP server. Idempotent per server (re-calling logs and returns early).
- `capture(server, eventData)` — emit an event onto the same pipeline. Defaults to `$mcp_custom`, but any event name can be supplied via `eventData.event` (custom names are sent verbatim, **not** `$`-prefixed). Returns a promise that resolves once the event has been processed, so callers can `await` it. The server must already have been passed to `instrument()`.

The host application supplies its own `posthog-node` client via `options.posthog` (same pattern as `@posthog/ai`) and owns its lifecycle — there is no SDK-managed client to flush or shut down. Internally, `instrument()` wraps that client in an `McpEventSink` (`src/extensions/sink.ts`, not exported) that runs the pipeline and calls `posthog.capture()`.

`instrument()` does five things (`src/index.ts`):

1. Validate `server` is either a low-level `Server` or a high-level `McpServer`, and unwrap the latter to get the underlying `Server`.
2. Wrap the user-provided `options.posthog` client in an `McpEventSink`.
3. Build per-server tracking state (session id, identity cache, callbacks, the sink) stored in a module-level `WeakMap`.
4. Replace the `tools/call` and `initialize` handlers on the underlying `Server` instance with wrappers, and (for `McpServer`) install a `Proxy` on `_registeredTools` so any tool registered _after_ `instrument()` is also wrapped.
5. Optionally register the `get_more_tools` virtual tool when `options.reportMissing: true`.

Two thin adapters exist for the two MCP server shapes, each wrapping the shared `traceToolCall()` lifecycle in `src/extensions/tracing-core.ts`:

| Server type                              | File                       | Entry                       |
| ---------------------------------------- | -------------------------- | --------------------------- |
| Low-level `Server` (raw protocol SDK)    | `src/extensions/tracing.ts`   | `setupToolCallTracing()`    |
| High-level `McpServer` (typed wrapper)   | `src/extensions/tracing-v2.ts`| `setupTracking()`           |

Both converge on the same internal `UnredactedEvent` shape (`src/types.ts`) and funnel through `traceToolCall` in `src/extensions/tracing-core.ts`, which owns the shared tool-call lifecycle and the same publish pipeline.

## 2. Request lifecycle (tool call, high-level path)

```
client → MCP server → tools/call wrapper (tracing-v2.ts) → traceToolCall (tracing-core.ts)
  ├─ prepareToolCallEvent         ← build UnredactedEvent, resolve session
  ├─ handleIdentify               ← fires $identify only if identity changed
  ├─ applyResolvedMetadata        ← runs eventProperties callback
  ├─ resolveToolCallIntent        ← context arg OR intentFallback callback
  ├─ execute(request, extra)      ← run the wrapped tool handler
  ├─ attach result, duration, error
  └─ captureEvent(server, event)  → McpEventSink.capture()
```

The wrapper strips the `context` argument from `params.arguments` before forwarding to the user's tool callback, so tool implementations never see the analytics-only arg.

## 3. Event pipeline

The pipeline lives in an exported `processMcpEvent()` function in `src/extensions/sink.ts` that **both** `McpEventSink.capture()` and the test harness call, so it's the single source of truth for the transform. Once an `UnredactedEvent` reaches it, it runs through:

1. **Sanitization** — `sanitizeEvent` (`src/extensions/sanitization.ts`):
   - `type: "image" | "audio"` content blocks → replaced with a text stub.
   - `type: "resource"` blocks with `.blob` → replaced.
   - Long base64-looking strings (≥10KB) → `"[binary data redacted...]"`.
   - Keys matching `SENSITIVE_KEY_PATTERN` (`authorization`, `cookie`, `password`, `token`, `secret`, `api_key`, `private_key`, …) → value replaced with `"[redacted]"`.
   - PostHog API-key patterns (`ph[a-z]_...`) in string values → `"[redacted]"`.
2. **Truncation** — `truncateEvent` (`src/extensions/truncation.ts`): per-field caps, recursive normalization (max depth 10, max breadth 100, max string 32KB), and a 100KB total event budget with progressive falloff.
3. **Build PostHog events** — `buildPostHogCaptureEvents` (`src/extensions/posthog-events.ts`) fans one internal event out to up to **2 PostHog events**:
   - Always: the main `$mcp_*` capture event.
   - If `event.isError && event.error` (and `enableExceptionAutocapture !== false`): a sibling `$exception` event.
4. **`beforeSend`** — each fully-built PostHog payload (`{ event, distinct_id, properties }`) is passed through `options.beforeSend(event)` (sync or async) right before dispatch — so it runs **once per emitted event**, including the `$exception` sibling. Returning the (possibly mutated) payload sends it; returning a nullish value drops it; a throw drops that event (and is logged). This is the seam for customer redaction or property tweaks.
5. **Dispatch** — each surviving event is handed to the user's `posthog-node` client via `posthog.capture()`. Batching, retries, and flushing are owned by that client. The host calls `posthog.shutdown()` to drain — the SDK installs no process-signal handlers and owns no client lifecycle.

## 4. Session & identity

- **Session ID format**: `ses_<uuidv7>` (`src/extensions/ids.ts`). Uses `uuidv7` from `@posthog/core`.
- **Session resolution order** (`src/extensions/session.ts`):
  1. If `extra.sessionId` (MCP protocol session) is present, derive a deterministic id by hashing it (`deterministicPrefixedId("ses", mcpSessionId)`). This means the same protocol session always maps to the same PostHog session across server restarts.
  2. If the MCP session id disappears mid-stream, keep using the last derived id (transient drops don't split sessions).
  3. Otherwise, generate `ses_<uuidv7>` and rotate after **30 minutes of inactivity** (`INACTIVITY_TIMEOUT_IN_MINUTES`).
- **`distinct_id`** (`posthog-events.ts`): `identifyActorGivenId || sessionId || "anonymous"`. Pre-identify events are session-scoped; once `options.identify()` returns a user, subsequent events attribute to that user and PostHog's standard identity merge takes over.
- **Person processing**: events for sessions with **no resolved identity** carry `$process_person_profile: false`, so anonymous MCP sessions don't each mint a throwaway person profile (the distinct id is just the session id). Once an identity is resolved, person processing stays on so `$set` lands on a real person.
- **`$identify` event**: fires only when the identity returned by `options.identify()` _changes_ for a given session. Dedupe is handled by an `IdentityCache` (bounded LRU, max 1000 entries) keyed by session id — but it is **per-server**: one instance lives on each server's tracking data via the `WeakMap` (`src/extensions/internal.ts`), so identities never bleed across server instances. An unchanged identity is silently deduped.
- **Groups (`$groups`)**: if `options.identify()` returns a `groups?: Record<string, string>` field (groupType → groupKey), it is stamped onto every event for that session as `$groups`. Callers never hand-write the `$groups` dollar-key themselves — they just return `groups` from `identify`.
- **Person properties (`$set`)**: built from `UserIdentity.userName` (→ `name`) and any `userData` keys.

## 5. Event catalog

All events are emitted by `buildPostHogCaptureEvents`. The main event name is computed by looking up the internal `MCPAnalyticsEventType` in `BUILT_IN_EVENT_NAME_BY_TYPE`.

| PostHog event          | When                                                          | Notable extras                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$mcp_tool_call`       | Every tool invocation                                         | `$mcp_tool_name`, `$mcp_tool_description`, `$mcp_parameters`, `$mcp_response`, `$mcp_duration_ms`, `$mcp_is_error`, optionally `$mcp_intent` / `$mcp_intent_source`               |
| `$mcp_tools_list`      | Client lists tools                                            | `$mcp_listed_tool_names` (array of tool names advertised); useful for "did this client discover us?" and "which advertised tools never get called?"                              |
| `$mcp_initialize`      | Client/server handshake                                       | `$mcp_client_name`, `$mcp_client_version`, `$mcp_server_name`, `$mcp_server_version`                                                                                            |
| `$mcp_missing_capability` | Agent calls the `get_more_tools` virtual tool             | A capability gap, **not** a tool invocation. The `context` arg is captured as `$mcp_intent` with `$mcp_intent_source = "context_parameter"`                                      |
| `$mcp_resources_list`  | Client lists resources                                        | —                                                                                                                                                                               |
| `$mcp_resource_read`   | Resource fetched                                              | `$mcp_resource_name`, `$mcp_parameters`, `$mcp_response`                                                                                                                        |
| `$mcp_prompts_list`    | Client lists prompts                                          | —                                                                                                                                                                               |
| `$mcp_prompt_get`      | Prompt fetched                                                | `$mcp_resource_name` (= prompt name)                                                                                                                                            |
| `$mcp_custom`          | `capture()` with no `event` (or `event: "$mcp_custom"`)       | Whatever the caller passed in `properties`. A custom `event` name routes to that name instead (sent verbatim)                                                                    |
| `$identify`            | `options.identify` returned a new identity for the session    | `$set` populated                                                                                                                                                                |
| `$exception`           | Sibling to any errored event (unless `enableExceptionAutocapture: false`) | `$exception_list`, `$exception_level` (standard `@posthog/core` error-tracking shape)                                                                              |

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

### Person & group properties

| Key                        | On                                | Source                                                                                       |
| -------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| `$set.name`                | events with a resolved identity   | `UserIdentity.userName`                                                                       |
| `$set.<anything>`          | events with a resolved identity   | Top-level keys of `UserIdentity.userData`                                                     |
| `$groups`                  | every event for the session       | `UserIdentity.groups` (`{ groupType: groupKey }`) — callers never hand-write the `$groups` key |
| `$process_person_profile`  | events with **no** resolved identity | Set to `false` so anonymous sessions don't mint a person profile each (see §4)             |

### Exception properties (`$exception` event)

`$exception_list` + `$exception_level` (the standard `@posthog/core` error-tracking shape — each exception carries `type`, `value`, `mechanism`, and a parsed `stacktrace.frames`), plus `$session_id`, `$mcp_resource_name`, `$mcp_tool_name` and `$mcp_tool_description` (tool calls only), `$mcp_server_*`, `$mcp_client_*`.

### Customer-defined properties

The `eventProperties` callback returns key/value pairs that are **spread flat at the top level of the PostHog event properties**, alongside the `$mcp_*` keys. They can therefore override built-in `$mcp_*` keys — intentional, so customers can backfill missing context. Values must be JSON-serializable; the SDK does not validate keys or values beyond truncation.

## 7. Customer extension points (`MCPAnalyticsOptions`, `src/types.ts`)

| Option                       | Default                                   | Use case                                                                                                                                |
| ---------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `posthog`                    | —                                         | A `posthog-node` client you construct and own (host, project token, batching, lifecycle all configured there). Without it, the server is instrumented but no events are sent — this is how you turn capture off (instrumentation is otherwise unconditional). |
| `logger`                     | no-op                                     | STDIO-safe log sink for SDK-internal warnings. Receives single string messages.                                                         |
| `enableExceptionAutocapture` | `true`                                    | When `false`, a failed tool call does not emit the sibling `$exception` event.                                                          |
| `enableConversationId`       | `false`                                   | Inject the `conversation_id` parameter into every tool and stamp `$mcp_conversation_id` on events.                                      |
| `reportMissing`              | `false`                                   | Register the `get_more_tools` virtual tool.                                                                                             |
| `context`                    | `true` (object form: `{ description }`)   | Inject required `context` arg into every tool schema.                                                                                   |
| `intentFallback`             | —                                         | Consumer-supplied callback returning a `$mcp_intent` string when the client didn't pass a `context` argument. SDK does no inference.    |
| `identify`                   | —                                         | Async function returning `UserIdentity \| null` (may include `groups`).                                                                  |
| `beforeSend`                 | —                                         | `(event) => event \| null \| undefined` (sync or async), matching posthog-node. Runs on each fully-built payload right before `posthog.capture()` — once per emitted event, including the `$exception` sibling. Return nullish (or throw) to drop that event. |
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

- The `get_more_tools` virtual tool emits its own `$mcp_missing_capability` event (a capability gap), **not** a `$mcp_tool_call`. Its `context` arg is recorded as `$mcp_intent` with `$mcp_intent_source = "context_parameter"`. It's defensible — the LLM did type a context string — but worth knowing if you segment by source.
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
| `McpEventSink` + `processMcpEvent` pipeline      | `src/extensions/sink.ts`                                      |
| Per-server `captureEvent` helper                 | `src/extensions/capture.ts`                                  |
| Shared tool-call lifecycle / list / initialize   | `src/extensions/tracing-core.ts`                              |
| High-level `McpServer` wrapping (thin adapter over `tracing-core`) | `src/extensions/tracing-v2.ts`              |
| Low-level `Server` wrapping (thin adapter over `tracing-core`)     | `src/extensions/tracing.ts`                 |
| Intent resolution (context arg + fallback)       | `src/extensions/intent.ts`                                    |
| Identity cache + identify dispatch               | `src/extensions/internal.ts`                                  |
| Session id derivation & timeout                  | `src/extensions/session.ts`, `src/extensions/ids.ts`             |
| `conversation_id` injection + minting            | `src/extensions/conversation-id.ts`                           |
| `get_more_tools` virtual tool                    | `src/extensions/tools.ts`                                     |
| Auto-redaction & binary stubbing                 | `src/extensions/sanitization.ts`, `src/extensions/mcp-payloads.ts` |
| Size / depth / breadth caps                      | `src/extensions/truncation.ts`                                |
| `context` JSON-Schema injection                  | `src/extensions/context-parameters.ts`                        |
| STDIO-safe logger sink                           | `src/extensions/logger.ts`                                    |
| Exception capture & stack-trace parsing          | `src/extensions/exceptions.ts`                                |
| MCP SDK version compat shims                     | `src/extensions/compatibility.ts`, `src/extensions/mcp-sdk-compat.ts` |
