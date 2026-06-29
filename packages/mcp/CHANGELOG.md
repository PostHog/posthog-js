# @posthog/mcp

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
