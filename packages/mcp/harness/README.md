# @posthog/mcp integration harness

Real MCP servers over real HTTP, instrumented with the workspace build of `@posthog/mcp` — the
integration gate behind the `MCP harness` CI workflow
([`.github/workflows/mcp-harness.yml`](../../../.github/workflows/mcp-harness.yml)), which blocks
every PR that affects `@posthog/mcp`.

The unit suite proves unit contracts; this harness proves that a real server, over real HTTP, on
either SDK major, still reports correctly. Between the lanes it covers the five things the package
exists to capture: **tool calls, errors, intent, sessions (conversation-id on and off), and the
NestJS customer stacks**.

## Running it

```bash
pnpm test:mcp-harness      # from the repo root: builds @posthog/mcp, runs all four lanes
```

Or one lane at a time — exactly what CI runs, one job per lane:

```bash
pnpm --filter @posthog/mcp run test:integration:sdk-v1     # "sdk v1"
pnpm --filter @posthog/mcp run test:integration:sdk-v2     # "sdk v2"
pnpm --filter @posthog/mcp run test:integration:nest-v1    # "nest mcp sdk v1"
pnpm --filter @posthog/mcp run test:integration:nest-v2    # "nest mcp sdk v2"
```

No secrets, no network: the PostHog client is an in-process recorder
(`dual-era/shared/posthog.mjs`, `nest-*/src/posthog.ts`) that serves recorded events back over
`/__events`. The harness runs on fork PRs.

Fixtures import `@posthog/mcp` through Node self-reference, which resolves to
`packages/mcp/dist` — they always test the workspace build. Rebuild after changing `src/`
(`pnpm test:mcp-harness` does this for you; for a single lane run
`pnpm exec turbo run build --filter=@posthog/mcp` first).

## What runs

| Lane | Path | Covers |
|---|---|---|
| `sdk v1` | `dual-era/matrix.mjs --major v1` | 4 rows: high/low-level instrumentation × stateful/stateless, legacy era |
| `sdk v2` | `dual-era/matrix.mjs --major v2` | 8 rows: high/low × 2025/2026 era × conversation-id on/off |
| both sdk lanes | `dual-era/probe-late-handlers.mjs` | handlers registered *after* `instrument()`, both majors — the mcp-nest/adapter ordering |
| | `dual-era/probe-first-call-error.mjs` | the **first** call of a conversation fails, with `conversation_id` on |
| | `dual-era/probe-pagination.mjs` | a **two-page** tool catalogue: `nextCursor`, `ttlMs`, `cacheScope` and result `_meta` survive the listing wrapper |
| `nest mcp sdk v1` | `nest-v1/verify.mjs` | NestJS + `@rekog/mcp-nest` 1.9 + SDK v1, stateless — 16 assertions × `LEVEL=high\|low` |
| `nest mcp sdk v2` | `nest-v2/verify.mjs` | NestJS + `@rekog/mcp-nest` 2.0 + SDK v2, stateless, both eras — 37 assertions × `LEVEL=high\|low` |

`LEVEL=high` is `instrument(server)`, as documented. `LEVEL=low` is `instrument(server.server)`,
the workaround users adopted before the compatibility gate opened. Both run.

**The matrix answers "does the SDK behave?". The Nest harnesses answer "does the customer's stack
work?"** A change can be green on one and broken on the other, which is why both run — the matrix
has no NestJS row (see [#4449](https://github.com/PostHog/posthog-js/issues/4449)).

The matrix asserts ten columns per row, grouped as capture (`calls`, `errors`, `intent`,
`schema`), identity (`session`, `client`, `protocol`) and safety (`warnings`, `header`, `alive`).

## Expected failures: exact-match snapshots

Known-broken cells are pinned in `dual-era/expected-failures.json` and
`nest-v2/expected-failures.json`, each entry carrying a `why`. A run passes iff the failing set
**exactly matches** the file:

- a new failure prints `regressed: …` and exits non-zero;
- a fixed one prints `now passing — remove from expected-failures.json: …` and *also* exits
  non-zero, so improvements are ratcheted in deliberately;
- a row that reports nothing — server never booted, client died mid-run — prints
  `no verdict: …` with the crash dump and exits non-zero. Silence is never a pass: an absent
  assertion renders as `·` (not applicable), so a crashed client would otherwise read green.

A floor ("≥35 of 37") would let a regression hide behind a coincidental improvement. Every cell
that moves needs a reason, and the diff of the snapshot file is where the reason lives.

Currently pinned: the four `v2 … 2025` `client` cells (`clientInfo` cannot reach a per-request
instance on the v2 SDK's legacy leg — documented limitation), the two `v2 low … conv=on`
`session` cells (parked: no tool registry to read ownership from on the low-level path), and
nest-v2's `error message is clean` on both eras (NestJS's `RpcExceptionsHandler` flattens every
thrown error to `"Internal server error"` — adapter behaviour, not ours).

Standing regression assertions on every PR: the four `v1` matrix rows stay all-green, and
`nest v1` stays **16/16** on both levels.

## Running one cell

Servers bind ephemeral ports by default (`PORT=0`) and announce the chosen port on stdout as
`MCP_HARNESS_LISTENING port=<n>`. Set `PORT` explicitly to pin one:

```bash
cd packages/mcp/harness/dual-era
PORT=3222 LEVEL=high CONVERSATION_ID=1 node servers/v2.mjs &
node client/run.mjs --url http://localhost:3222 --sdk v2 --lane 2026 --conv on
```

| Env / flag | Meaning |
|---|---|
| `PORT` | explicit port; default 0 = ephemeral |
| `LEVEL=high\|low` | high-level `McpServer` or bare low-level `Server` |
| `MODE=` | v1: `stateful`/`stateless` · v2: `perrequest`/`longlived` |
| `CONVERSATION_ID=1` | turn on `enableConversationId` (off by default) |
| `CUSTOM_3ARG=1` | register a custom method via v2's 3-argument form after `instrument()` |
| `--sdk v1\|v2` | client-side: which SDK major serves the URL (era-conditional assertions) |
| `--conv on` | client-side: expect the injected parameter and echo the handle |

Same shape for a Nest harness: `LEVEL=low node harness/nest-v2/verify.mjs`.

## Why it is built this way

- **Real HTTP, not in-process transports.** Two assertions are impossible in process: *"the
  response carries no `mcp-session-id` header"* is an absence you can only observe on the wire,
  and `createMcpHandler`'s per-request server instances only exist under a real handler.
- **Raw JSON-RPC over `fetch`, never the SDK `Client`.** A stock v2 `Client` negotiates the
  **legacy** era and sends an `initialize` handshake — it exercises none of 2026-07-28 and
  reports green anyway.
- **The verifiers replay `Mcp-Session-Id`**, because a real client does. On a stateless server
  that replayed token is the only thing carrying client info and the negotiated protocol version
  between per-request instances.
- **Identical tool surface everywhere** — `echo`, `add`, `fail_always`. If a number differs
  between harnesses it is the SDK or the adapter doing it, not the fixture.
- **Ephemeral ports.** Fixed shared ports let a row occasionally reach the *previous* row's dying
  server, which shows up as a red cell indistinguishable from a regression.
- **Assertions, not eyeballs.** Every verifier exits non-zero; the matrix reconciles against its
  expected-failures snapshot.
- **Match handles, not wording.** A fixture that pins the sentence carrying a value turns an
  intended wire-format change into a red cell indistinguishable from a regression. Assert the
  value.

What the matrix cannot see: its fixture fails on the **last** call, so first-call error ordering
needs `probe-first-call-error.mjs`; every catalogue fits on one page, so envelope loss needs
`probe-pagination.mjs`. A column that is green because the fixture never reaches the code is
indistinguishable, in the grid, from one that is green because the code is right.

One thing this gate cannot answer: whether a model **chooses** to cooperate (above all
`enableConversationId`, whose mechanism is the agent threading a handle back). That needs a
model-in-the-loop rig, which is not part of CI — ask the package maintainers before changing the
conversation-id delivery contract.

## Wire formats the client lanes must send

- **Legacy (`2025-11-25`)** requires `MCP-Protocol-Version` on every request after `initialize`.
- **Modern (`2026-07-28`)** needs **all** of: `params._meta` carrying
  `io.modelcontextprotocol/protocolVersion`, `/clientInfo` **and** `/clientCapabilities` (omitting
  capabilities returns `-32602 Invalid _meta envelope`); an `Mcp-Method` header matching the
  body's method; an `Mcp-Name` header for `tools/call` / `prompts/get` / `resources/read`; and no
  handshake.

`NodeStreamableHTTPServerTransport` tops out at `2025-11-25`, so **only `createMcpHandler` serves
the modern era**, and it is per-request by construction.
