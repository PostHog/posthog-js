# Plan: Minimal `@posthog/browser`

## Goal

Create `@posthog/browser` as a new package in `packages/browser-v2`.

The package will provide a small but complete capture path. It will not copy the current `PostHog` class.

The root package will use the existing `Client` and `Extension` contracts from `@posthog/browser-common`.

## Main design rule

The root must contain capture behavior. The root must not contain product feature implementations.

Capture includes these functions:

- Consent enforcement.
- Bot detection.
- Identity and session state.
- Basic persistence.
- Event construction.
- An in-memory batch.
- Native compression.
- Transport.
- Bounded retry.
- Extension lifecycle.

The implementation must use modern browser APIs. Heavy compatibility code stays outside the root.

## Package structure

```text
packages/browser-v2/
├── src/
│   ├── index.ts
│   ├── browser-client.ts
│   ├── capture.ts
│   ├── identity.ts
│   ├── session.ts
│   ├── store.ts
│   ├── delivery.ts
│   ├── consent.ts
│   ├── bot-filter.ts
│   ├── remote-config.ts
│   └── extensions/
│       ├── client-adapter.ts
│       ├── registry.ts
│       └── loader.ts
├── tests/
├── fixtures/
├── scripts/
├── package.json
└── rslib.config.ts
```

The npm package will use these entrypoints:

```text
@posthog/browser
@posthog/browser/standard
@posthog/browser/persistence/cookie
@posthog/browser/persistence/durable
@posthog/browser/delivery/durable
@posthog/browser/compression/fflate
@posthog/browser/extensions/*
@posthog/browser/migrate/posthog-js
```

## Root behavior

The root will provide one useful capture client.

```ts
import { createPostHog } from '@posthog/browser'

const posthog = await createPostHog('<project-token>', {
    apiHost: 'https://us.i.posthog.com',
})

await posthog.capture('signed_up', { plan: 'pro' })
```

The factory will return only after identity and extension startup are complete.

The root will not create a default singleton. A default singleton adds import side effects and hidden global state.

### Public API

```ts
interface BrowserClient {
    capture(event, properties?, options?): Promise<void>
    identify(distinctId, properties?): Promise<void>
    group(type, key, properties?): Promise<void>
    reset(): void
    flush(): Promise<void>
    installExtension(extension): Promise<Disposable>
    loadExtension(loader): Promise<Disposable>
    getExtension(token): Extension | undefined
    dispose(): Promise<void>
}
```

`capture()` will resolve after the queue accepts the event. `flush()` will wait for the current delivery work.

## Capture pipeline

Use one fixed pipeline. Do not add a generic middleware system.

```text
capture()
  → read consent state
  → apply the bot filter
  → read identity and session state
  → add dynamic properties
  → add caller properties
  → add protected protocol properties
  → publish onEvent
  → add the event to the batch
  → compress the batch when useful
  → send the batch
  → retry a bounded number of times
```

The pipeline will copy caller-owned data. It will not mutate properties or configuration from the caller.

Protocol properties will win over extension properties. An extension cannot replace the project token or identity fields.

## Minimal implementations

### Persistence

Keep a small local-storage implementation in the root.

Use one versioned record for identity, groups, consent, and session data. Use memory when local storage fails.

Do not include these functions in the root:

- Cookie support.
- IndexedDB support.
- Legacy persistence keys.
- V1 data migrations.
- Cross-tab synchronization.
- Durable event queues.

Expose these functions through separate entrypoints.

Run the V1 migration only when the application imports `@posthog/browser/migrate/posthog-js`.

### Bot detection

Keep a compact blocked-user-agent filter in the root.

Do not import the full browser and device detection graph. Put detailed browser enrichment in a browser-context extension.

### Compression

Use `CompressionStream` when the browser supports it.

Send uncompressed data when `CompressionStream` is unavailable. Do not include `fflate` in the root.

Compress only batches that exceed a measured threshold. Compression increases work for small payloads.

Expose the JavaScript fallback through `@posthog/browser/compression/fflate`.

### Delivery

Use one `Delivery` boundary:

```ts
interface Delivery {
    enqueue(event: Event): Promise<void>
    flush(options?: { unload?: boolean }): Promise<void>
    request(path: string, init?: SendRequestInit): Promise<ApiResponse>
    dispose(): Promise<void>
}
```

The root implementation will use:

- An in-memory batch.
- `fetch`.
- `sendBeacon` during page unload.
- A short timeout.
- A small retry limit.
- No durable queue.

The durable delivery entrypoint can add IndexedDB, longer retries, and offline delivery.

This single boundary replaces separate transport, queue, batch, compression, and retry frameworks.

## Extension host

Use `Extension` from `packages/browser-common/src/extension.ts` without changes.

Use `Client` from `packages/browser-common/src/client.ts` as the extension-facing API.

The production adapter must implement all `Client` members. The adapter must not expose the concrete capture implementation.

### Extension-scoped client

Create a small client view for each extension.

This view will provide:

- Extension-scoped `kv`.
- An extension-scoped logger.
- Shared identity and session reads.
- Shared capture and request methods.
- Shared event publishers.

This design keeps extension storage keys separate.

### Extension registry

Use an extension name map for lifecycle, duplicate detection, and optional app-facing lookup. Callers can also retain the extension instance when they need its controls.

Install an extension with this sequence:

1. Reserve the extension name.
2. Create the extension-scoped client.
3. Run `setup(client)`.
4. Publish the ready state.

If setup fails, dispose the extension. Then remove all reserved state.

Dispose extensions in reverse installation order.

### Dynamic loading

The root must not contain a list of extension implementations.

Callers can load an extension explicitly:

```ts
await posthog.loadExtension(async () => {
    const module = await import('@posthog/browser/extensions/feature-flags')
    return module.featureFlags()
})
```

The `standard` entrypoint can provide a loader map. Each loader must create a separate dynamic chunk.

## Standard entrypoint

`@posthog/browser/standard` will provide the recommended browser configuration.

It can install these small extensions during startup:

- Browser context.
- Page views.
- Page leaves.
- Campaign properties.

It can load these extensions after remote configuration arrives:

- Autocapture.
- Feature flags.
- Error tracking.
- Replay.
- Surveys.
- Product tours.
- Web vitals.
- Logs.
- Metrics.

Report the initial size and the total loaded size separately.

## Shared extension migration

Place shared extension implementations in `@posthog/browser-common` only after both SDK versions use them.

Follow this order:

1. Port browser context.
2. Port page views.
3. Port feature flags.
4. Port error tracking.
5. Port autocapture.
6. Port replay.
7. Port surveys and product tours.

Add a static V1 `Client` adapter in `packages/browser`.

Run each shared extension against these clients:

- The V1 adapter.
- The V2 adapter.
- `TestClient` from `@posthog/browser-common`.

Do not add the V2 dynamic loader to the V1 default bundle.

## Build rules

Build unbundled ES modules and CommonJS modules with Rslib.

Use ES2023 as the source target. Let application bundlers select their target.

Add an exact `exports` map. Do not expose internal file paths.

Set `sideEffects: false` for the npm module graph. Keep snippet and global entrypoints in separate packages or allowlists.

The root must not import these packages:

- `core-js`
- `fflate`
- `preact`
- `dompurify`
- `rrweb`
- `web-vitals`

The root must not import `packages/browser` or the `@posthog/core` root barrel.

Use type-only imports for `Client`, `Extension`, and public types.

## Size plan

Measure a packed-package consumer bundle. Do not measure source files or unbundled output alone.

Create these fixtures:

| Fixture         | Purpose                                    |
| --------------- | ------------------------------------------ |
| `capture`       | Create a client and capture one event      |
| `identity`      | Identify, group, reset, and capture        |
| `standard`      | Install the standard browser configuration |
| `feature-flags` | Load feature flags dynamically             |
| `replay`        | Load replay dynamically                    |
| `all`           | Load every supported extension             |
| `ssr-import`    | Import the package without browser globals |

Measure each fixture with esbuild and Rollup.

Report these values:

- Minified bytes.
- Gzip bytes.
- Brotli bytes.
- Initial chunks.
- Dynamic chunks.
- Total loaded bytes.
- Module attribution.

### Alpha size limits

These limits are ceilings, not estimates:

| Artifact                  | Gzip ceiling |
| ------------------------- | -----------: |
| Root capture fixture      |       12 KiB |
| Root stretch target       |        8 KiB |
| Standard initial bundle   |       16 KiB |
| Browser-context extension |        3 KiB |
| Feature-flags loader code |        4 KiB |
| Bot filter                |        2 KiB |
| Cookie persistence        |        3 KiB |
| Durable delivery adapter  |        6 KiB |

Record the first measured baseline. Then reduce each ceiling to the measured value plus 2%.

CI must fail when an optional implementation enters the root graph.

CI must also fail when a bundle exceeds its absolute ceiling.

## Implementation phases

### Phase 0: Freeze the boundary

1. Write the root behavior contract.
2. Write the capture delivery contract.
3. Write the persistence schema.
4. Write the extension startup rules.
5. Add the consumer size fixtures.

Do not add runtime code before the size fixtures work.

### Phase 1: Create the package

1. Create `packages/browser-v2`.
2. Add the `@posthog/browser` package metadata.
3. Add the Rslib build.
4. Add the exact export map.
5. Add package-consumer tests.
6. Keep the package private.

### Phase 2: Implement capture

1. Implement consent state.
2. Implement compact bot detection.
3. Implement identity and session state.
4. Implement versioned local-storage persistence.
5. Implement the fixed event pipeline.
6. Implement in-memory batching.
7. Implement native compression.
8. Implement Fetch and Beacon delivery.
9. Implement bounded retry.
10. Add `capture`, `identify`, `group`, `reset`, `flush`, and `dispose`.

Measure the capture fixture after each step.

### Phase 3: Implement the shared client adapter

1. Implement the `Client` interface.
2. Add the shared `Publisher` instances.
3. Add extension-scoped KV stores.
4. Add extension-scoped loggers.
5. Add the token registry.
6. Add extension setup rollback.
7. Add reverse-order disposal.
8. Add explicit dynamic loading.

Run the shared contract tests against V2.

### Phase 4: Add remote configuration

1. Put remote configuration in a dynamic host module.
2. Load the module when an extension requests configuration.
3. Cache the first request.
4. Publish later configuration changes.
5. Return `undefined` after a permanent request failure.

Do not load remote configuration for direct capture users.

### Phase 5: Add the standard entrypoint

1. Add the standard extension list.
2. Keep heavy implementations behind dynamic imports.
3. Define extension startup order.
4. Define missing-provider behavior.
5. Report initial and total loaded sizes.

### Phase 6: Port shared extensions

1. Add the V1 `Client` adapter.
2. Port one extension at a time.
3. Keep each token module implementation-free.
4. Add a separate export for each extension.
5. Run the same behavior tests against V1 and V2.

### Phase 7: Add compatibility modules

1. Add cookie persistence.
2. Add the V1 persistence migration.
3. Add durable delivery.
4. Add the JavaScript compression fallback.
5. Add older transport fallbacks only when browser support requires them.

Keep every compatibility module outside the root graph.

### Phase 8: Release the alpha

1. Run unit tests.
2. Run real-browser tests.
3. Run packed-package tests.
4. Run size tests.
5. Run the read-only code review.
6. Publish `@posthog/browser@2.0.0-alpha.0`.

Do not change `posthog-js` release output during the alpha.

## Release acceptance criteria

The alpha must meet these conditions:

- The root fixture stays below 12 KiB gzip.
- The root imports no product extension.
- The root imports no heavy production dependency.
- Package import performs no storage, DOM, timer, or network work.
- `createPostHog` enforces consent before durable writes.
- Capture failures do not break the host application.
- Extension failures do not stop capture.
- Multiple clients do not share mutable state.
- Extension cleanup is safe after partial setup.
- Dynamic extensions stay outside the initial chunk.
- V1 behavior and CDN artifacts remain unchanged.
- CI reports both initial bytes and total loaded bytes.

The first milestone is Phase 0 plus the capture fixture. That work gives every later decision measurable size evidence.
