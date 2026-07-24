---
name: develop-extension
description:
    Author a new PostHog browser extension, or port a posthog-js v1 extension, against the @posthog/browser-common
    Client/Extension contract. Use when adding or porting an extension (autocapture, pageview, surveys, replay,
    exceptions, web-vitals, campaign-params, feature flags, …).
---

# Authoring a browser extension

A browser extension is an opt-in feature (autocapture, replay, surveys, …) that plugs into a host SDK through one
contract: it implements `Extension` and talks to the host through the `Client` it is handed and the capabilities in the
client's extension registry. The contract is designed for shared extensions across browser generations. Concrete host
adapters and loading integrations remain owned by their SDK packages.

## The shape

Prefer a class when porting a posthog-js v1 extension that is already a class. Retaining the original method boundaries
(`startIfEnabled`, `stop`, `monitor...`, private capture helpers, etc.) makes the port easier to review and keeps future
fixes easy to compare with v1. Don't flatten a good class into a bag of closures.

```ts
import type { Client, Extension } from '@posthog/browser-common'

export interface MyExtensionOptions {
    enabled?: boolean
}

export class MyExtension implements Extension {
    readonly name = 'myExtension'

    private _client: Client | undefined

    constructor(private readonly _options: MyExtensionOptions = {}) {}

    setup(client: Client): void | Promise<void> {
        this._client = client
        this.startIfEnabled()
    }

    startIfEnabled(): void {
        // wire up capabilities here; keep any Disposables you create
    }

    stop(): void {
        // tear down listeners/timers/patches owned by this instance
    }

    dispose(): void | Promise<void> {
        this.stop()
        this._client = undefined
    }
}
```

- `name` — unique; used for de-duplication and diagnostics.
- `setup(client)` — may be `async` so you can read async state (kv, remote config) before the extension is ready; the
  host awaits it.
- `dispose()` — may be `async` (final flush, etc.); the host awaits it on teardown.
- Extensions should define their own static configuration derived from the SDK's initialization configuration, and
  accept it via the **constructor**. This keeps the configuration contract explicit and avoids the need for handling
  generic configuration types.
- Once `setup()` runs, the extension will not be called again until `dispose()`. Use `setup()` to initialize listeners
  to react to changes.

## `Client` and `CoreExtension` — what you get, and when to use it

`Client` provides host services and resolves extension capabilities. A conforming host must register `CoreExtension`
before product extensions are set up:

```ts
import { CoreExtension } from '@posthog/browser-common'

const core = client.getExtension(CoreExtension)
if (!core) {
    throw new Error('CoreExtension is required')
}
```

| Need                                                        | Use                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| current identity                                            | `core.distinctId`, `core.anonymousId`, `core.groups` (sync reads)             |
| current session                                             | `core.session` (sync; `{ sessionId, windowId, sessionStartTimestamp }`)       |
| record an event                                             | `await core.capture(event, properties?, options?)`                            |
| add properties to **every** event                           | `core.registerDynamicEventProperties(() => ({ … }))`                          |
| **react** to events others capture                          | `core.onEvent(({ event, properties }) => …)`                                  |
| call a PostHog endpoint (`/s/`, `/flags/`, `/api/surveys/`) | `await client.apiRequest(path, init?)`                                        |
| server config (decide/flags response)                       | `await core.getRemoteConfig()` (current) / `core.onRemoteConfig(…)` (changes) |
| react to a new session / reset                              | `core.onNewSession(({ reason, … }) => …)`                                     |
| use another extension                                       | `client.getExtension(SomeToken)`                                              |
| persist small state                                         | `client.kv` (`get`/`set`/`remove` are awaitable and use keys verbatim)        |
| log                                                         | `client.logger`                                                               |

## Hard rules

- **Enrichers are synchronous.** `core.registerDynamicEventProperties(producer)` runs inline while the host builds an
  event — it must not `await`. If you need persisted/async data, read it in `setup` and close over the result.
- **Enrich = add; observe = react.** `registerDynamicEventProperties` _contributes_ properties to events. `onEvent`
  _watches_ finalized events and reacts (it can't change them). Dropping/rewriting whole events is the host's
  `beforeSend`, not an extension's job.
- **Do not drop disposables.** Anything returned from `core.onEvent`, `core.registerDynamicEventProperties`,
  `core.onNewSession`, another `Listener`, or a timer wrapper must be stored and disposed in your `dispose()`. Use
  `createDisposable(teardown)` when adapting callback teardown into a reusable idempotent handle.
- **Reads are sync, I/O is awaitable.** Core identity and session are synchronous in-memory reads. `capture`,
  `apiRequest`, `kv`, and `getRemoteConfig` are awaitable.
- **Design for async readiness.** Your extension may be set up _after_ events have already been captured (dynamic
  loading) or before flags/remote-config have loaded. Never assume you saw the first event or that data is present at
  `setup`; `await core.getRemoteConfig()` / the providing extension's reads resolve once ready.
- **Persist through `client.kv`, not globals.** Keys are passed verbatim to shared host persistence. In browser-v1,
  unknown keys are normally sent as event properties, collisions overwrite host/core state, and reset clears them.
  Use a stable extension-owned key, never store sensitive data without approved transmission, and call `remove`
  explicitly when deleting it (`set(key, null | undefined)` is not deletion). Every new SDK-owned key needs an
  explicit event/hidden/derived exposure policy in each host.
- **browser-common owns shared extensions outright.** SDKs must not wrap, subclass, or re-export per-extension
  adapter classes. An SDK may construct the shared extension with SDK-derived constructor options, but the only
  extension methods the SDK calls directly are `setup(clientAdapter)` and `dispose()`. Ordinary feature interaction
  goes through `Client` and registered capabilities such as `CoreExtension`. If an extension needs controls (`start`,
  `stop`, etc.), expose them on the shared extension itself, not through SDK-specific wrappers.

## Providing a capability to other extensions

If your extension exposes something others depend on (e.g. feature flags), declare a token + interface and list it in
`provides`. Use `Publisher` for any event stream you expose: keep the publisher private, expose its `listener`.

```ts
// flags/token.ts — implementation-free, importable without pulling flags' code
import type { Extension, ExtensionToken, Listener } from '@posthog/browser-common'

export interface FeatureFlagsChange {
    flag: string
    value: string | boolean | undefined
}

export interface FeatureFlagsExtension extends Extension {
    getFeatureFlag(key: string): Promise<string | boolean | undefined>
    onChange: Listener<FeatureFlagsChange>
}

export const FeatureFlags = 'posthog.featureFlags' as ExtensionToken<FeatureFlagsExtension>
```

```ts
// flags/index.ts
import { Publisher } from '@posthog/browser-common'
import { FeatureFlags, type FeatureFlagsChange, type FeatureFlagsExtension } from './token'

export function featureFlags(): FeatureFlagsExtension {
    const changes = new Publisher<FeatureFlagsChange>()

    return {
        name: 'featureFlags',
        provides: [FeatureFlags],
        onChange: changes.listener,
        setup() {},
        dispose() {
            changes.dispose()
        },
        async getFeatureFlag(key) {
            // read flag state from this extension's internals
            return undefined
        },
    }
}
```

The extension must be assignable to each token's type (the registry casts on lookup — the compiler does not check this
for you). A token is a branded runtime string, so use a package-qualified value that is globally unique and stable across
separately compiled scripts (for example, `posthog.featureFlags`).

## Depending on another extension

Resolve by token; handle absence (it may not be installed or loaded yet):

```ts
import { FeatureFlags } from './flags/token'

setup(client) {
    const flags = client.getExtension(FeatureFlags)
    if (flags && (await flags.getFeatureFlag('my-flag'))) { … }
}
```

Import the **token** (and the interface type), never the providing extension's implementation — that keeps your chunk
free of its code and keeps it lazily loadable.

## Tree-shaking

- Keep token modules implementation-free.
- Where extension subpath exports exist, expose one subpath per extension.
- Cross-extension references go through token modules only.
- Don't statically import another extension's implementation.

## Porting from v1

Map v1's reach-into-`this._instance` calls onto `Client` and the resolved `CoreExtension`:

| v1                                                            | Shared extension                                       |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| `instance.capture(e, p)`                                      | `core.capture(e, p)`                                   |
| `instance.get_distinct_id()`                                  | `core.distinctId` (sync)                               |
| `instance.get_property(k)` / `persistence`                    | `client.kv.get(k)` (awaitable)                         |
| `instance.config.X` (static)                                  | constructor                                            |
| `instance.config.X` (server-driven)                           | `core.getRemoteConfig()` / `onRemoteConfig`            |
| `instance.sessionManager.checkAndGetSessionAndWindowId(true)` | `core.session` (sync)                                  |
| `_addCaptureHook` / observing events                          | `core.onEvent(...)`                                    |
| returned unregister / subscription disposables                | store and dispose in `dispose()`                       |
| `instance.onFeatureFlags(cb)`                                 | `client.getExtension(FeatureFlags)?.onChange(cb)`      |
| `instance.featureFlags.getFeatureFlag(k)`                     | `client.getExtension(FeatureFlags)?.getFeatureFlag(k)` |
| registering an enricher                                       | `core.registerDynamicEventProperties(fn)`              |
| `requestRouter.endpointFor(...)` + `_send_request`            | `client.apiRequest(path, init?)`                       |
| snapshot/keepalive send on unload                             | `client.apiRequest(path, { unload: true })`            |

## Checklist

- [ ] All disposables are properly disposed in `dispose()`.
- [ ] Enrichers are synchronous; async data read in `setup`.
- [ ] Cross-extension deps via `getExtension(token)`, undefined handled.
- [ ] If you provide a capability: token + interface defined, listed in `provides`.
- [ ] If you expose an event stream: private `Publisher`, public `publisher.listener`.
- [ ] No static import of another extension's implementation.
- [ ] Own subpath export added when the package has a public extension entrypoint.
- [ ] Tests cover setup, teardown, behavior, and any shared global patching/multi-instance behavior.
