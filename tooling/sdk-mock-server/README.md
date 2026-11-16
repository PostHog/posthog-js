# SDK mock HTTP server

Private Node.js tooling for browser SDK tests. It serves PostHog-shaped HTTP endpoints,
records exact request bytes and decoded JSON, and supports response gates and faults.
Each server owns its state, captures, sockets and gates. No SDK or browser-test framework
is imported by this package.

From the workspace root (using the repository's Node and pnpm versions):

```sh
pnpm install --frozen-lockfile
pnpm turbo run build check-types test:unit lint --filter=@posthog-tooling/sdk-mock-server
```

Direct `test:unit` assumes the package has been built. Runtime exports are ESM with
TypeScript declarations in `dist/`.

## Lifecycle and exports

```js
import { createMockServer, buildConfigResponse } from '@posthog-tooling/sdk-mock-server'

const mock = createMockServer({
    state: { projectToken: 'phc_fixture', sessionReplayEnabled: false },
    barriers: ['config', 'flags', 'extensions'],
})
const origin = await mock.start()
try {
    // Point the SDK's ingestion and asset hosts at origin.
    mock.releaseBarrier('config')
    mock.releaseBarrier('flags')
    const evidence = mock.inspect()
} finally {
    await mock.stop()
}
```

Runtime exports:

- `createMockServer(options?: MockServerOptions): MockServer`
- `buildConfigResponse(state: MockState): JsonObject`
- `buildFlagsResponse(state: MockState): JsonObject`

Type exports: `JsonObject`, `JsonValue`, `MockState`, `Endpoint`, `RequestRecord`,
`MockRequest`, `MockResponse`, `BlockedRequest`, `Captured`, `Inspection`,
`AdapterContext`, `MockServerOptions`, `MockServer`.

`MockServer` methods:

| Method                                      | Behavior                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start(): Promise<string>`                  | Listen on `127.0.0.1`, returning the origin. Port defaults to `0`; `options.port` selects a fixed port. Repeated starts return the same origin.      |
| `stop(): Promise<void>`                     | Terminal, idempotent shutdown. Cancels gates/delays and closes active and idle connections. Create a new instance to start again.                    |
| `reset(): void`                             | Cancel in-flight SDK/adapter requests, clear evidence and restore initial state/gates. Cancelled requests receive 503 if their socket is still open. |
| `getState(): MockState`                     | Detached state snapshot.                                                                                                                             |
| `updateState(patch: JsonObject): MockState` | Recursive object merge; arrays, null and scalars replace. Returns detached state.                                                                    |
| `inspect(): Inspection`                     | Detached evidence snapshot.                                                                                                                          |
| `clearCaptured(): void`                     | Clear captured payloads, recorded requests and errors; keep state/gates and in-flight requests. Use reset for a new run.                             |
| `holdBarrier(name: string): void`           | Close a named response gate.                                                                                                                         |
| `releaseBarrier(name: string): void`        | Open it and release every waiter.                                                                                                                    |
| `barriers(): Record<string, boolean>`       | Known gate names mapped to whether they are open. Unknown gates are open until explicitly held.                                                      |

`options.state` supplies **top-level replacements** over defaults. For example, an
initial `flags` bag replaces the default bag; subsequent control updates deep-merge
it. Reset restores these initial overrides, not another SDK's state. Adapter/response
callback closures belong to the caller and are not reset by the package.

## HTTP endpoints

| Endpoint                       | Response / capture                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /array/<token>/config`    | JSON project configuration.                                                                                                                                                  |
| `GET /array/<token>/config.js` | JavaScript assigning `window._POSTHOG_REMOTE_CONFIG[state.projectToken].config`.                                                                                             |
| `POST /flags`, `/decide`       | Flags, JSON-stringified non-boolean payloads, replay configuration, generated request ID/evaluation time. Full decoded request goes to `flags_calls`.                        |
| `GET /api/surveys`             | `{surveys: [...]}` from state when enabled, otherwise an empty array.                                                                                                        |
| `POST /batch`                  | Flatten `batch`, an array or a single event into `events`; respond `{status: "ok"}`.                                                                                         |
| `POST /e`, `/i/v0/e`           | Same capture, respond `{status: 1}`.                                                                                                                                         |
| `POST /s`, `/newS`             | Full decoded replay envelopes in `snapshots`, respond `{status: "ok"}`.                                                                                                      |
| `POST /i/v1/logs`              | Full OTLP envelopes in `logs`, respond `{status: "ok"}`. Query token and headers remain in request evidence.                                                                 |
| `POST /i/v1/analytics/events`  | Native Capture V1: retain `created_at` and ordered `batch`; respond `{results: {[uuid]: {result: "ok"}}}`. Capture events without rewriting options, identity or properties. |

POST paths and `/api/surveys` accept a trailing slash. Config/script responses use
`projectToken` from state; tokens/auth are recorded, not validated. HTTP success does
not imply validation by production ingestion. Unknown routes return 404 and enter
`errors`. Config requests also append timestamps to `config_calls`.

Wire decoding accepts JSON, gzip (header, magic bytes, `compression=gzip` or
`gzip-js`), base64 bodies, and URL-encoded `data` containing JSON or base64. A
`data=` envelope is recognized even with a Beacon/text content type. Node removes
chunk framing before decoding. Empty bodies decode to null; malformed/unsupported
encoding returns 400 with raw evidence, a `decodeError` and an inspection error.
No replay codec normalization or payload filtering occurs.

Every response has CORS and no-store headers. OPTIONS returns 204, echoing requested
CORS headers, including authorization/content-encoding. The origin is loopback-only;
foreign Host/absolute destinations and proxy CONNECT are denied and recorded in
`errors`. This deny-only proxy never forwards traffic; the browser harness must also
block egress paths that do not use it.

### State and faults

Default replay is enabled with endpoint `/s/`; flags are `bool-value: true`,
`string-value: "test"`, `disabled-flag: false`; project token is `phc_MOCK`.
Surveys default to disabled with no fixture definitions.

Replay knobs: `sessionReplayEnabled`, `linkedFlag`, `sampleRate` (serialized as a
string), `eventTriggers`, `minimumDurationMilliseconds`. Other knobs: `flags`,
`flagsQuotaLimited`, `hasFeatureFlags` (null omits the wire field), `projectToken`,
`surveysEnabled`, `surveys`. SDK-specific survey fixtures stay with their harness.

`configOverrides` and `flagsOverrides` recursively merge into generated responses.
Use these for product settings and deterministic flags metadata. Quota-limited flags
return `{quotaLimited: ["feature_flags"]}` before applying overrides.

`Endpoint` is `config | flags | batch | snapshot | logs | captureV1 | surveys`.
`delays[endpoint]` injects seconds; `force500[endpoint]` returns
`500 {status: "forced_500"}`. Built-in endpoint gates use the same names. Capture and
response construction happen **after** the gate/delay; a state change during a hold
is reflected in the released response. Failed ingestion attempts are still captured.
Default gate timeout is 45 seconds, configurable via `barrierTimeoutMs`; timeout
returns 400 and records an error. Disconnect, reset and stop remove gate waiters.

`options.respond(endpoint, request, defaultResponse, state)` can return a replacement
`MockResponse` (synchronously or asynchronously) after capture. Use it for custom
HTTP statuses/Retry-After, Capture V1 outcomes, or combining config with flags.

### Control and inspection

| Endpoint                           | Behavior                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `GET /__control/state`             | State snapshot.                                                              |
| `POST /__control/state`            | Deep-merge a JSON object, return state; other inputs return 400.             |
| `POST /__control/reset`            | Reset and return `{reset: true}`.                                            |
| `GET /__control/barriers`          | Gate state.                                                                  |
| `POST /__control/release`          | `{barriers: ["config", "flags"]}` opens gates.                               |
| `GET /__captured`                  | Counts for `events`, `snapshots`, `logs`, `flags_calls`, `config_calls`.     |
| `GET /__captured/all`              | Full `Inspection`.                                                           |
| `GET /__captured/<bucket>?since=N` | Any inspection array, sliced by index (negative indexes count from the end). |
| `DELETE /__captured`               | Clear evidence, return `{cleared: true}`.                                    |

Control/inspection requests and preflights are excluded from recorded requests.
`Inspection` includes full payload buckets plus `requests`, `blockedRequests` and
`errors`. `RequestRecord` contains:

- `id`, `method`, `path`, `query` (all values per key), lowercase Node `headers`
- `rawBody` (UTF-8 view), `rawBodyBase64` (exact bytes, including gzip)
- decoded `body`, `bodyWrapper`, `contentType`, `contentEncoding`, optional `decodeError`
- `status` (null until response), `responseFinished` (Node finished writing)

Do not use the UTF-8 view to reconstruct binary requests; use base64. Requests become
visible once their bodies have been read, **before** response gates. Pending gate
records have `{id, barrier, method, path}`. Batch/nested array order is retained.

## SDK fixture adapter

`options.adapter(request, context)` runs before built-in endpoint dispatch and may
return a `MockResponse` or undefined to fall through. Known controls/inspection and
preflights are handled first. `MockResponse` is `{status?, headers?, json?, body?}`;
`body` takes precedence and accepts a string or byte array. Default status is 200,
default JSON is `{}`. Set a Content-Type when serving HTML/JavaScript.

`MockRequest` extends the evidence record with `url: URL`, `rawBytes: Buffer` and
`signal: AbortSignal`. Treat request data as read-only. `context.getState()` reads
live state; `context.waitForBarrier(name)` gates this request and shares timeout,
disconnect/reset/stop cancellation with backend endpoints. Async adapters must honor
the signal or use the context's barrier for bounded waits.

```js
const mock = createMockServer({
    barriers: ['extensions'],
    adapter: async (request, context) => {
        if (request.method === 'GET' && request.path === '/') {
            return { body: fixtureHtml, headers: { 'Content-Type': 'text/html' } }
        }
        if (request.method === 'GET' && request.path === '/static/surveys.js') {
            await context.waitForBarrier('extensions')
            return { body: surveyAssetBytes, headers: { 'Content-Type': 'text/javascript' } }
        }
    },
})
```

The harness resolves and validates its own CDN artifacts and version-fallback/fault
routes; the backend records returned statuses and response order. A harness can expose
its own inspection route using `mock.inspect()`. For a raw-request consumer expecting
`{headers, body: string}`, project records to `{headers, body: rawBody}` while retaining
`rawBodyBase64` and decoded `body` in separate run evidence. Browser-specific fixture,
artifact, assertion and snapshot logic stays outside this package.
