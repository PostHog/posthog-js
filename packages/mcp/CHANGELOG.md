# @posthog/mcp

## 0.11.2

### Patch Changes

- [#4463](https://github.com/PostHog/posthog-js/pull/4463) [`b8e5d06`](https://github.com/PostHog/posthog-js/commit/b8e5d0602fb2bc52e91d86d1347973fa2fcb213a) Thanks [@gesh](https://github.com/gesh)! - Resolve client name, version and protocol version through a fallback chain, so events from an MCP SDK v2 server carry them.

  MCP SDK v2 lifts the reserved `io.modelcontextprotocol/*` keys — `clientInfo`, `protocolVersion`, `clientCapabilities` — out of `params._meta` while parsing a request, and puts them on the request envelope. We only read `params._meta`, which is empty by the time a handler runs, so `$mcp_client_name`, `$mcp_client_version` and `$mcp_protocol_version` went missing on exactly the modern-era traffic that carries them per request rather than at `initialize`.

  Identity is now resolved field by field through three sources in order: the v2 request envelope, then `params._meta`, then the server's own `getClientVersion()` and (v2-only) `getNegotiatedProtocolVersion()`. A chain rather than a branch, because the same v2 server serves 2025-era requests routinely — era is a per-request property, never a module constant — and because a field one source cannot answer may still be known to the next. (2026-08-10)

- [#4464](https://github.com/PostHog/posthog-js/pull/4464) [`8b5165e`](https://github.com/PostHog/posthog-js/commit/8b5165e0c6a40e97597b9890d197fabc2cb4e5d5) Thanks [@gesh](https://github.com/gesh)! - Install and type-check cleanly on a project that has only MCP SDK v2.

  `@modelcontextprotocol/sdk` (v1) was a required peer, so installing `@posthog/mcp` into a project built on `@modelcontextprotocol/server` (v2) pulled the entire v1 SDK in as an auto-installed peer — 87 packages where 1 was wanted — and tooling that walks the dependency tree reported it as missing when it was absent. Both majors are now declared and both are optional, which is what the code has always assumed: no `@modelcontextprotocol/*` package is imported at runtime, and server shapes are detected structurally.

  Making the peer optional exposed a second half of the same problem. The published type declarations still imported `CallToolResult` and `ListToolsResult` from `@modelcontextprotocol/sdk/types.js`, so a consumer without the v1 SDK hit `TS2307` on an install that otherwise worked — fine at runtime, broken under `tsc` without `skipLibCheck`. Those MCP wire shapes are now declared structurally in `types.ts` too.

  The shapes we read are open-ended, so a value typed by either SDK assigns to them. What the package hands back is typed precisely and stays assignable to the SDK's own `CallToolResult`, so `getMoreToolsResult()` can still be returned straight from a tool callback. (2026-08-10)

## 0.11.1

### Patch Changes

- [#4462](https://github.com/PostHog/posthog-js/pull/4462) [`2fc1211`](https://github.com/PostHog/posthog-js/commit/2fc12118f173d673937feb714bf94aa4df1c0826) Thanks [@gesh](https://github.com/gesh)! - Instrument high-level `McpServer` instances from MCP TypeScript SDK v2, and read request headers from either SDK major.

  The compatibility gate required `typeof server.tool === 'function'`. SDK v2 dropped the deprecated `tool()` in favour of `registerTool()`, so every v2 high-level server failed the check — and since `instrument()` catches compatibility failures and returns a working-looking handle, it failed silently: no throw, no warning at the call site, and no `$mcp_*` events at all. The gate now accepts either registration method, and every shape question it asks is answered by a structural probe in the new `detect.ts` rather than by a version or protocol constant.

  Opening the gate is also what first sends v2-shaped request context to header reads, so both halves ship together. The SDK's own reads go through a new `getRequestHeaders(extra)`, which takes headers from v2's `ctx.http.req` (a WHATWG `Request`, whose headers only answer to `.get()`) as well as v1's `extra.requestInfo.headers`, and returns a plain lowercase-keyed object either way. It is duck-typed on `.entries` rather than `instanceof Headers`, so a `Headers` from another realm — workerd and other edge runtimes — is read correctly.

  `getRequestHeaders` is exported, because `identify`, `intentFallback`, `eventProperties` and `beforeSend` still receive the SDK's `extra` unchanged — we deliberately do not synthesise a v1 `requestInfo` on v2, as a partially faked shape is worse than an absent one. Hosts reading headers in a callback migrate in one line:

  ````ts
  import { getRequestHeaders } from '@posthog/mcp'

  identify: async (request, extra) => {
    const auth = getRequestHeaders(extra)?.['authorization']
    // ...
  }
  ``` (2026-08-10)
  ````

## 0.11.0

### Minor Changes

- [#4419](https://github.com/PostHog/posthog-js/pull/4419) [`e3be62f`](https://github.com/PostHog/posthog-js/commit/e3be62f3bb36fed0b9301b454370d91122f4a057) Thanks [@lucasheriques](https://github.com/lucasheriques)! - Capture the calling client's User-Agent and vendor client header on every auto-captured MCP event, as `$mcp_client_user_agent` and `$mcp_vendor_client`.

  MCP's own `clientInfo` can't tell a vendor's products apart — Anthropic reports `clientInfo.name = "claude-code"` from the CLI, the Agent SDK, the VS Code extension and the desktop app alike, so `$mcp_client_name` collapses them into one bucket. The surface is only visible in the User-Agent parenthetical (`claude-code/2.1.0 (cli)` vs `(sdk-ts)` vs `(claude-vscode)`), so capturing it is what lets you see which of your integrations traffic actually comes from.

  Automatic on HTTP transports (`instrument()` reads the headers per request); stdio and in-memory servers, which have no headers, are unchanged. On the `PostHogMCP` custom-dispatcher path, pass `clientUserAgent` / `vendorClient` on your capture calls. Both values are recorded raw — PostHog resolves them to friendly product labels at query time, so labels keep improving without an SDK upgrade. (2026-08-07)

## 0.10.9

### Patch Changes

- [#4461](https://github.com/PostHog/posthog-js/pull/4461) [`f457521`](https://github.com/PostHog/posthog-js/commit/f4575212113fb48f73a23695fa883aa6e06e8447) Thanks [@gesh](https://github.com/gesh)! - Wrap request handlers registered with a method string, and stop breaking three-argument registrations. MCP TypeScript SDK v2 calls `setRequestHandler('tools/call', handler)` where v1 passed a Zod schema, so `instrument()` could not name those registrations and left them unwrapped — a handler bound after `instrument()` silently replaced the analytics wrapper, and no `$mcp_tool_call` or `$mcp_tools_list` was captured. Frameworks that attach handlers post-construction, such as `@rekog/mcp-nest`, do exactly this on every request.

  The patched `setRequestHandler` now also forwards every argument it is given. v2's three-argument form for custom methods — `setRequestHandler(method, { params, result }, handler)` — previously lost its handler and threw `setRequestHandler: handler is required`, taking down the host server rather than just instrumentation. (2026-08-07)

- [#4450](https://github.com/PostHog/posthog-js/pull/4450) [`69e47bd`](https://github.com/PostHog/posthog-js/commit/69e47bd1b1f276258a25958f2608d0e8a2f88f5c) Thanks [@gesh](https://github.com/gesh)! - Register the synthetic `tools/call` fallback by writing into the server's handler map instead of calling `setRequestHandler`. Instrumenting a low-level `Server` that never declared a `tools` capability no longer fails with `Server does not support tools` and leaves instrumentation half-applied — it now instruments cleanly, and answers a call for a tool no dispatcher claims with `Unknown tool: <name>`. This also removes the last runtime `@modelcontextprotocol/sdk` import from the published bundle; the SDK is now referenced only as a type.
  (2026-08-07)

## 0.10.8

### Patch Changes

- [#4433](https://github.com/PostHog/posthog-js/pull/4433) [`c514a34`](https://github.com/PostHog/posthog-js/commit/c514a34e82c5ccd3995b64d6cf1f8b878413f52c) Thanks [@gesh](https://github.com/gesh)! - Deliver the `conversation_id` session handle on errored tool results, and inject it into
  the virtual `get_more_tools` tool. A first call that fails no longer sends the agent's
  retry into a different conversation, and a reported capability gap now groups with the
  work that hit it. (2026-08-06)

- [#4428](https://github.com/PostHog/posthog-js/pull/4428) [`7322893`](https://github.com/PostHog/posthog-js/commit/732289369cdfeee30b0c6dcbed9957b60e8c630f) Thanks [@gesh](https://github.com/gesh)! - Use an agent-supplied `conversation_id` as the session anchor, so tool calls in one
  conversation share a `$session_id` across reconnects, restarts, and per-request server
  instances. Only a handle the SDK could have minted is accepted; a value the agent invented
  is replaced with a fresh one, so two callers cannot land in the same session by sending the
  same string. (2026-08-06)

- [#4431](https://github.com/PostHog/posthog-js/pull/4431) [`955df8d`](https://github.com/PostHog/posthog-js/commit/955df8d0feb2ff5ac494431295f738ea7af4e0cf) Thanks [@gesh](https://github.com/gesh)! - Mirror the `conversation_id` session handle into `structuredContent` for tools whose
  output schema declares `_mcp_instructions`. Clients that read structured results never
  saw the handle in `content`, so correlation for those tools was zero. (2026-08-06)

- [#4430](https://github.com/PostHog/posthog-js/pull/4430) [`e6d9295`](https://github.com/PostHog/posthog-js/commit/e6d9295a5382dd6be7f6d87e2ddf65f57ed24e01) Thanks [@gesh](https://github.com/gesh)! - Declare an optional `_mcp_instructions` property on the output schema of tools that
  advertise one, when `enableConversationId` is on. Inert by itself — it is the schema
  declaration that makes a later change able to mirror the conversation handle into
  `structuredContent` without failing client-side validation. (2026-08-06)
- Updated dependencies [[`4751b33`](https://github.com/PostHog/posthog-js/commit/4751b33a0498fa36a9d2e11a98d4ef94ca60c5dc), [`64ba193`](https://github.com/PostHog/posthog-js/commit/64ba19370e4a974596712296c8a7f80ddbcc13b1)]:
  - posthog-node@5.48.1
  - @posthog/core@1.46.9

## 0.10.7

### Patch Changes

- [#4357](https://github.com/PostHog/posthog-js/pull/4357) [`632049c`](https://github.com/PostHog/posthog-js/commit/632049cc8b3ba3a9dc76d00be68ebe7de9eaa69d) Thanks [@marandaneto](https://github.com/marandaneto)! - Prevent concurrent MCP requests from leaking identity and session attribution.
  (2026-08-04)
- Updated dependencies [[`facb4c1`](https://github.com/PostHog/posthog-js/commit/facb4c1e173c0afc6b4c14154a0e65ed239d43f4)]:
  - posthog-node@5.47.9

## 0.10.6

### Patch Changes

- [#4356](https://github.com/PostHog/posthog-js/pull/4356) [`1eab19a`](https://github.com/PostHog/posthog-js/commit/1eab19a7b80ed275059cb17d9b513e8fbac6d94e) Thanks [@marandaneto](https://github.com/marandaneto)! - Preserve real missing-capability tools when their names collide with the configured virtual tool.
  Restore `$mcp_tool_call` analytics for low-level servers that register their tool dispatcher after instrumentation. (2026-08-04)

## 0.10.5

### Patch Changes

- [#4359](https://github.com/PostHog/posthog-js/pull/4359) [`d2f5041`](https://github.com/PostHog/posthog-js/commit/d2f504156faee7fe008388c70ec451339002cd3a) Thanks [@marandaneto](https://github.com/marandaneto)! - Isolate logger configuration per instrumented MCP server.
  (2026-08-04)

## 0.10.4

### Patch Changes

- [#4379](https://github.com/PostHog/posthog-js/pull/4379) [`4d8df50`](https://github.com/PostHog/posthog-js/commit/4d8df50bea343aee7626483d4c3be9703bafc024) Thanks [@marandaneto](https://github.com/marandaneto)! - Preserve tool-owned analytics arguments across event capture, low-level servers, and strict schemas.
  (2026-08-04)

## 0.10.3

### Patch Changes

- [#4355](https://github.com/PostHog/posthog-js/pull/4355) [`57f371e`](https://github.com/PostHog/posthog-js/commit/57f371e540968afaa8a0fe9aec8a53ef1db6b654) Thanks [@marandaneto](https://github.com/marandaneto)! - Preserve user-defined `context` and `conversation_id` tool arguments.
  (2026-08-03)
- Updated dependencies [[`7c3a9af`](https://github.com/PostHog/posthog-js/commit/7c3a9af42be80051705f7fe820623dd7e1b879d5)]:
  - @posthog/core@1.46.2
  - posthog-node@5.47.4

## 0.10.2

### Patch Changes

- [#4358](https://github.com/PostHog/posthog-js/pull/4358) [`575c5e7`](https://github.com/PostHog/posthog-js/commit/575c5e75cc4f7ad39ac41001994e76194765bdbf) Thanks [@marandaneto](https://github.com/marandaneto)! - Redact sensitive exception messages and large binary payload encodings from MCP analytics.
  (2026-07-31)

## 0.10.1

### Patch Changes

- [#4237](https://github.com/PostHog/posthog-js/pull/4237) [`23ce761`](https://github.com/PostHog/posthog-js/commit/23ce761b44f51d1bb46aa07b0e1becbf31ae878c) Thanks [@gesh](https://github.com/gesh)! - Read the MCP client name/version and protocol version from each request's `_meta` (`io.modelcontextprotocol/clientInfo` and `io.modelcontextprotocol/protocolVersion`), so `$mcp_client_name`, `$mcp_client_version`, and `$mcp_protocol_version` keep populating under the MCP 2026-07-28 stateless revision, which removes the `initialize` handshake. Existing clients are unaffected — when `_meta` is absent, the values from the session token / `initialize` still apply.
  (2026-07-27)

## 0.10.0

### Minor Changes

- [#4210](https://github.com/PostHog/posthog-js/pull/4210) [`e732595`](https://github.com/PostHog/posthog-js/commit/e7325959c4c365895945ae06091fd74439ecb2db) Thanks [@gesh](https://github.com/gesh)! - feat(mcp): capture the negotiated MCP protocol version as `$mcp_protocol_version`

  The SDK now stamps `$mcp_protocol_version` — the MCP spec version negotiated at `initialize` (read off the server's initialize response) — on the `$mcp_initialize` event and on **every** subsequent event for the session (tool calls, listings, and the `$exception` sibling). It's persisted in per-server session info and, on stateless / multi-pod deployments, recovered on other pods from the session token, which now carries the client's requested version in a new `pv` field. Use it to track MCP spec-revision adoption and to break event metrics (error rate, latency) down by spec version.

  `SessionTokenPayload` gains an optional `protocolVersion`, and `PostHogMCP.captureInitialize` accepts an optional `protocolVersion`. (2026-07-21) (2026-07-22)

## 0.9.1

### Patch Changes

- [#4144](https://github.com/PostHog/posthog-js/pull/4144) [`3c8e17e`](https://github.com/PostHog/posthog-js/commit/3c8e17e5a8c83083a15e8075f766b7b75cebdcc5) Thanks [@gesh](https://github.com/gesh)! - fix(mcp): publish `$identify` at most once per session instead of before every tool call

  On stateless / multi-pod deployments the SDK rebuilds its per-server identity cache on every request, so the dedupe check saw an empty cache each time and emitted a standalone `$identify` before every `$mcp_tool_call`. The SDK now publishes `$identify` at most once per session — at `initialize`, when a long-lived server first sees the identity, or when the identity materially changes. Every event still carries `distinct_id`/`$set`, so no person data is lost when a standalone `$identify` is suppressed. (2026-07-15)

## 0.9.0

### Minor Changes

- [#4123](https://github.com/PostHog/posthog-js/pull/4123) [`c8d036e`](https://github.com/PostHog/posthog-js/commit/c8d036e1656aa30a63405a2e672f4695eae5c5b9) Thanks [@gesh](https://github.com/gesh)! - feat(mcp): stable sessions and client metadata on stateless / multi-pod MCP servers

  On stateless servers every request became its own session and `$mcp_client_name`/`$mcp_client_version` were missing after `initialize`. The SDK now mints the `Mcp-Session-Id` response header at `initialize` as a token carrying the session id and client name/version; clients replay it on every request, so any pod recovers both with no server-side store. Auto-minting requires `enableJsonResponse: true` on `StreamableHTTPServerTransport`; SSE-mode servers can set the header at the HTTP layer with the new exports.

  New exports: `encodeSessionId`, `decodeSessionId`, `MCP_SESSION_HEADER`, `SessionTokenPayload`, `newSessionId`. (2026-07-10)

## 0.8.0

### Minor Changes

- [#4032](https://github.com/PostHog/posthog-js/pull/4032) [`93bbc4b`](https://github.com/PostHog/posthog-js/commit/93bbc4b96967db3eb9d1632d2ca273f3a8f1e907) Thanks [@lucasheriques](https://github.com/lucasheriques)! - Stamp `$mcp_error_type` and `$mcp_error_message` on `$mcp_tool_call` (and `$mcp_tools_list`) when a call fails. Previously the only failure signal on the primary event was the `$mcp_is_error` boolean, so breaking failures down by reason meant joining to the `$exception` sibling (which can be disabled, and isn't emitted when no error value is passed). `$mcp_error_type` defaults to the thrown error's type, and `captureToolCall`/`captureToolsList` accept an explicit low-cardinality `errorType` label (e.g. `validation`, `permission`, `timeout`, `rate_limited`) for hosts that classify their own failures.
  (2026-07-03)

## 0.7.0

### Minor Changes

- [#4025](https://github.com/PostHog/posthog-js/pull/4025) [`5590094`](https://github.com/PostHog/posthog-js/commit/5590094403a1f9484f3e08a5e21311f6adb0cc60) Thanks [@gesh](https://github.com/gesh)! - Stamp the standard PostHog `$lib` / `$lib_version` (value `posthog-node-mcp`) on every event, so MCP events self-identify the same way every other PostHog SDK does. Both emit paths are covered: `PostHogMCP` overrides its library id, and `instrument()` applies it to the client you pass in. Note that posthog-node sets `$lib` at the client level, so for `instrument()` this relabels every event that client sends as `posthog-node-mcp` — pass a client dedicated to your MCP server's analytics.
  (2026-06-30)

## 0.6.0

### Minor Changes

- [#4022](https://github.com/PostHog/posthog-js/pull/4022) [`d9e19e0`](https://github.com/PostHog/posthog-js/commit/d9e19e020b5e5306887793b80ce861e9ea5097d8) Thanks [@gesh](https://github.com/gesh)! - Emit `$mcp_lib` (`@posthog/mcp`) and `$mcp_lib_version` on every `$mcp_*` event (and the `$exception` sibling) so you can tell which analytics SDK release produced the data. The version was already resolved at runtime but never mapped to a property. Namespaced like `@posthog/ai`'s `$ai_lib` rather than overriding `$lib`, which stays the transport SDK (`posthog-node`).
  (2026-06-30)

## 0.5.1

### Patch Changes

- [#4009](https://github.com/PostHog/posthog-js/pull/4009) [`ae68de1`](https://github.com/PostHog/posthog-js/commit/ae68de1fd602cfdacbe6d0501583479862e4e252) Thanks [@gesh](https://github.com/gesh)! - Fix `$mcp_client_name` being dropped from every other captured event. `getSessionInfo` cached the client identity but then overwrote the cache with `undefined` on the next event, so consecutive tool calls alternated between carrying and lacking the client name (showing up as a large "other" slice in MCP analytics). The cached client name/version are now reused instead of refetched.
  (2026-06-29)

## 0.5.0

### Minor Changes

- [#3995](https://github.com/PostHog/posthog-js/pull/3995) [`e86f61a`](https://github.com/PostHog/posthog-js/commit/e86f61a30df9fec6f59ba2de4c4b2cb596fd0d7f) Thanks [@lucasheriques](https://github.com/lucasheriques)! - Add `instrumentMutator(posthog, options?)` — a point-free `(server) => server` helper for framework server-mutation hooks like `@rekog/mcp-nest`'s `serverMutator`. It instruments the server and returns it, so `serverMutator: instrumentMutator(posthog)` just works (no need to remember that `instrument()` returns the analytics handle, not the server).
  (2026-06-26)

## 0.4.4

### Patch Changes

- [#3896](https://github.com/PostHog/posthog-js/pull/3896) [`606ef43`](https://github.com/PostHog/posthog-js/commit/606ef43d69fd09a00a67df2a404d8739cc50c654) Thanks [@GauthierPLM](https://github.com/GauthierPLM)! - Forward $groups as a first-class groups field from the MCP analytics sink so the group association is no longer dropped on $mcp\_\* events (fixes #3888).
  (2026-06-26)
- Updated dependencies [[`606ef43`](https://github.com/PostHog/posthog-js/commit/606ef43d69fd09a00a67df2a404d8739cc50c654)]:
  - posthog-node@5.38.6

## 0.4.3

### Patch Changes

- [#3993](https://github.com/PostHog/posthog-js/pull/3993) [`fb43a92`](https://github.com/PostHog/posthog-js/commit/fb43a92a293f8a47d9be93925557ef6efb4cda96) Thanks [@gesh](https://github.com/gesh)! - Instrument MCP request handlers through a single `setRequestHandler` patch instead of one per method. Internal refactor — no change to the analytics captured.
  (2026-06-26)
- Updated dependencies [[`6200888`](https://github.com/PostHog/posthog-js/commit/6200888e5741dea2e6e11a5da1c98b6c79e62a3f)]:
  - @posthog/core@1.38.0

## 0.4.2

### Patch Changes

- [#3976](https://github.com/PostHog/posthog-js/pull/3976) [`a29194f`](https://github.com/PostHog/posthog-js/commit/a29194f82b6603805a032b3864cad00d16dd4116) Thanks [@gesh](https://github.com/gesh)! - Capture tool listings (and the injected `context` parameter) on MCP servers that register their `tools/list` handler after `instrument()` runs — e.g. `@rekog/mcp-nest`, which hands a bare server to `instrument()` and only then registers its handlers.
  (2026-06-25)

## 0.4.1

### Patch Changes

- [#3936](https://github.com/PostHog/posthog-js/pull/3936) [`06c23d8`](https://github.com/PostHog/posthog-js/commit/06c23d8959a6a5c1c322d7eb722ac4731121a50f) Thanks [@lucasheriques](https://github.com/lucasheriques)! - Re-export `PostHog` (and the `PostHogOptions` type) from `@posthog/mcp`, so you can import the client and `instrument` from a single package:

  ```ts
  import { PostHog, instrument } from '@posthog/mcp'
  ```

  `posthog-node` remains a peer dependency (resolved from the host app's installed copy); this only unifies the import. `PostHogMCP` is also already accepted by `instrument()` if you prefer a single client class. (2026-06-23)

## 0.4.0

### Minor Changes

- [#3883](https://github.com/PostHog/posthog-js/pull/3883) [`ddd9e7e`](https://github.com/PostHog/posthog-js/commit/ddd9e7e158a47f02f3bc347ae55c40e4a6a5d5b9) Thanks [@lucasheriques](https://github.com/lucasheriques)! - Bring the `PostHogMCP` custom-dispatcher path up to the same `$mcp_*` events as `instrument()` for intent, the `get_more_tools` virtual tool, and tool listings. Custom MCP servers (hono, edge, any setup without a `Server`/`McpServer` to wrap) can now emit those events too. (`instrument()`'s server-side `intentFallback` and `enableConversationId` callbacks aren't mirrored — a custom dispatcher owns its request loop and can do both inline.)
  - `prepareToolList(tools, { context, reportMissing })` injects the `context` argument into tool input schemas and optionally appends the `get_more_tools` tool.
  - `prepareToolCall(name, args)` returns `{ intent, intentSource, args, isMissingCapability }` — pulls the agent-supplied intent, strips the injected `context` argument before your handler runs, and flags `get_more_tools` calls.
  - `captureToolCall` now accepts `intent`/`intentSource`, emitting `$mcp_intent` and `$mcp_intent_source`.
  - `captureMissingCapability(...)` emits `$mcp_missing_capability`, plus a standalone `getMoreToolsResult()` for the canned response.
  - `captureToolsList(...)` emits `$mcp_tools_list` with the advertised tool names.
  - `setLogger` is now exported so custom servers can surface the SDK's internal warnings.
  - The missing-capability (`get_more_tools`) tool name is now customizable via `missingCapabilityToolName` (defaults to `get_more_tools`) on **both** paths: the `PostHogMCP` constructor option and the `instrument()` `MCPAnalyticsOptions`. Set once, it's used for both advertising the tool and detecting calls to it, so the name can't drift between injection and detection. (2026-06-18)

## 0.3.0

### Minor Changes

- [#3829](https://github.com/PostHog/posthog-js/pull/3829) [`125dee2`](https://github.com/PostHog/posthog-js/commit/125dee23f6f92d5a4881f20434d5cbd82e7199ad) Thanks [@DanielVisca](https://github.com/DanielVisca)! - Auto-capture `$mcp_tool_category` on `$mcp_tool_call` events. The wrapping path (`track()`/`instrument()`) reads a `category` declared on a tool's `_meta` block (cached from `tools/list` and seeded from `_registeredTools`), and `PostHogMCP.captureToolCall` accepts a first-class `category` field. Declaring `_meta: { category: "Logs" }` on a tool definition is all a server needs for every call to carry the category, enabling per-category dashboards in PostHog MCP analytics.
  (2026-06-16)

### Patch Changes

- Updated dependencies [[`b3ec845`](https://github.com/PostHog/posthog-js/commit/b3ec8453d3678bd7ab6737b25bae003e61117ef9), [`a0553b3`](https://github.com/PostHog/posthog-js/commit/a0553b305679f995e244cad7498c7521cb4c849d), [`c6c163a`](https://github.com/PostHog/posthog-js/commit/c6c163aefb093d5609977ae243b056f96a2d3b4e)]:
  - @posthog/core@1.33.0
  - posthog-node@5.38.0

## 0.2.1

### Patch Changes

- [#3837](https://github.com/PostHog/posthog-js/pull/3837) [`29bf8e3`](https://github.com/PostHog/posthog-js/commit/29bf8e386a4050531e9cfd906c33b75945fcb6ad) Thanks [@marandaneto](https://github.com/marandaneto)! - Add missing bugs metadata to package manifests.
  (2026-06-15)
- Updated dependencies [[`29bf8e3`](https://github.com/PostHog/posthog-js/commit/29bf8e386a4050531e9cfd906c33b75945fcb6ad)]:
  - @posthog/core@1.32.4
  - posthog-node@5.37.1

## 0.2.0

### Minor Changes

- [#3781](https://github.com/PostHog/posthog-js/pull/3781) [`b732ecb`](https://github.com/PostHog/posthog-js/commit/b732ecb0ce83b656782b525eefbdfde42555d9c9) Thanks [@lucasheriques](https://github.com/lucasheriques)! - Add `PostHogMCP`, a `posthog-node` client subclass with first-class MCP analytics for servers that have no `Server`/`McpServer` to wrap (e.g. custom hono/HTTP dispatchers). It extends `PostHog` — so `capture`, `identify`, `flush`, `shutdown`, and feature flags all work unchanged — and adds `captureToolCall` / `captureInitialize`, which build the canonical `$mcp_*` events and run them through the same sanitize → truncate → `$exception` fan-out pipeline as `instrument()` before handing them to the inherited `capture()` (so the client's own `beforeSend` applies). The caller passes `distinctId`/`sessionId`/`groups`/`properties` per call. `$session_id` is now omitted from events when no session is supplied (previously always set), so stateless captures don't bucket into a non-existent Session Replay session.
  (2026-06-11)

## 0.1.28

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.32.3
  - posthog-node@5.36.17

## 0.1.27

### Patch Changes

- Updated dependencies [[`25822ac`](https://github.com/PostHog/posthog-js/commit/25822acc0d16f9f1d6fbbd65da57b3e060c6c558)]:
  - @posthog/core@1.32.2
  - posthog-node@5.36.16

## 0.1.26

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.32.1
  - posthog-node@5.36.15

## 0.1.25

### Patch Changes

- Updated dependencies [[`612f97a`](https://github.com/PostHog/posthog-js/commit/612f97adebd3d863602533180ac4bee3f3ed731d)]:
  - @posthog/core@1.32.0
  - posthog-node@5.36.14

## 0.1.24

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.31.4
  - posthog-node@5.36.13

## 0.1.23

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.31.3
  - posthog-node@5.36.12

## 0.1.22

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.31.2
  - posthog-node@5.36.11

## 0.1.21

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.31.1
  - posthog-node@5.36.10

## 0.1.20

### Patch Changes

- Updated dependencies [[`0c2acb9`](https://github.com/PostHog/posthog-js/commit/0c2acb9f30d545bb89d1f950ba8f840c76e47dc2)]:
  - @posthog/core@1.31.0
  - posthog-node@5.36.9

## 0.1.19

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.14
  - posthog-node@5.36.8

## 0.1.18

### Patch Changes

- Updated dependencies [[`7820929`](https://github.com/PostHog/posthog-js/commit/78209299874f932e55b0050d3b891f5c8dbd66a6)]:
  - posthog-node@5.36.7
  - @posthog/core@1.30.13

## 0.1.17

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.12
  - posthog-node@5.36.6

## 0.1.16

### Patch Changes

- [#3772](https://github.com/PostHog/posthog-js/pull/3772) [`e243ea4`](https://github.com/PostHog/posthog-js/commit/e243ea42e93bf3b80236d6a166c05c99fcfda2ff) Thanks [@lucasheriques](https://github.com/lucasheriques)! - First release of `@posthog/mcp` from the posthog-js monorepo. Instrument an MCP server with a single `instrument(server, posthog)` call to auto-capture tool calls, tool listings, initialize, identity, and exceptions to PostHog. BYO `posthog-node` client; `beforeSend` hook; `identify({ distinctId, properties, groups })`; `$mcp_missing_capability`; anonymous sessions sent with `$process_person_profile: false`.
  (2026-06-08)

## 0.1.15

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.11
  - posthog-node@5.36.5

## 0.1.14

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.10

## 0.1.13

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.9

## 0.1.12

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.8

## 0.1.11

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.7

## 0.1.10

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.6

## 0.1.9

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.5

## 0.1.8

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.4

## 0.1.7

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.3

## 0.1.6

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.2

## 0.1.5

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.30.1

## 0.1.4

### Patch Changes

- Updated dependencies [[`3d4a76f`](https://github.com/PostHog/posthog-js/commit/3d4a76f323ac789df91448fdb05d356dc91bb87f)]:
  - @posthog/core@1.30.0

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @posthog/core@1.29.15

## 0.1.2

### Patch Changes

- Updated dependencies [[`d9ad199`](https://github.com/PostHog/posthog-js/commit/d9ad1993d320ffc899dd57ce2f1cf1787e9c6635)]:
  - @posthog/core@1.29.14

## 0.1.1

### Patch Changes

- Updated dependencies [[`7b84b75`](https://github.com/PostHog/posthog-js/commit/7b84b7599d076c9c3c86f923f7d56cf937ad9874)]:
  - @posthog/core@1.29.13
