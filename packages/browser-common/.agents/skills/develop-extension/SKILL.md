---
name: develop-extension
description:
    Author a new PostHog browser extension, or port a posthog-js v1 extension, against the @posthog/browser-common
    Client/Extension contract. Use when adding or porting an extension (autocapture, pageview, surveys, replay,
    exceptions, web-vitals, campaign-params, feature flags, …).
---

# Authoring a browser extension

A browser extension is an opt-in feature that implements `Extension` and talks to its host SDK exclusively through the
single `Client` adapter passed to `setup` and shared by extensions on that SDK instance. The contract is designed for
extensions shared across browser generations; concrete host adapters and loading integrations remain owned by their SDK
packages.

## The shape

Prefer a class when porting a posthog-js v1 extension that is already a class. Retaining its method boundaries makes the
port easier to review and keeps future fixes comparable with v1.

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
        // Install listeners and patches here; retain every Disposable.
    }

    stop(): void {
        // Release resources owned by this instance.
    }

    dispose(): void {
        this.stop()
        this._client = undefined
    }
}
```

- `name` is unique within one client and is used for diagnostics and de-duplication.
- `setup(client)` may be async when it needs KV or other asynchronous state.
- `dispose()` is optional, synchronous, idempotent, and best-effort.
- Static SDK configuration belongs in explicit constructor options, not in `Client`.

When other extensions need its controls, export an implementation-free typed token from a small contract module:

```ts
import type { Extension, ExtensionToken } from '@posthog/browser-common'

export interface MyExtensionApi extends Extension {
    stop(): void
}

export const MyExtensionToken = 'myExtension' as ExtensionToken<MyExtensionApi>
```

The token string must match the implementation's `name`. Keep the interface and token separate from the implementation
so consumers do not pull its code into their bundles.

## Client capabilities

| Need                          | Use                                                        |
| ----------------------------- | ---------------------------------------------------------- |
| current identity              | `client.distinctId`, `client.anonymousId`, `client.groups` |
| current session               | `client.session`                                           |
| check capture permission      | `client.canCapture`                                        |
| record an event               | `await client.capture(event, properties?, options?)`       |
| add properties to every event | `client.registerDynamicEventProperties(() => ({ … }))`     |
| react to finalized events     | `client.onEvent(({ event, properties }) => …)`             |
| access an installed extension | `client.getExtension(MyExtensionToken)`                    |
| call a PostHog endpoint       | `await client.sendRequest(path, init?)`                    |
| react to server config        | `client.onRemoteConfig(…)`                                 |
| persist small state           | `client.kv`                                                |
| log                           | `client.logger`                                            |

Create an extension-named child logger with `client.logger.createLogger('[myExtension]')` when its messages need a
prefix. `onRemoteConfig` immediately replays the latest known outcome; narrow on `result.ok` before reading
`result.config` and define safe behavior for `{ ok: false }`.

`sendRequest` is a low-level transport bridge. Select the configured origin with `target` (`api`, `flags`, or
`assets`) and construct endpoint authentication using `client.projectToken` in the required query parameter, body,
header, or path.

## Hard rules

- **Enrichers are synchronous.** `registerDynamicEventProperties` runs inline while the host builds an event. Read any
  async state during setup and close over it.
- **Enrich = add; observe = react.** Dynamic properties contribute to events; `onEvent` observes finalized events and
  cannot mutate them.
- **Keep disposables.** Store and release values returned by listeners, dynamic-property registration, and timer or
  patch wrappers. Use `createDisposable(teardown)` for idempotent synchronous cleanup.
- **Treat extension lookup as optional.** `getExtension(token)` returns `undefined` when the named extension is absent
  or has been removed. A resolved extension may still be running `setup`; use typed stable-name tokens and avoid
  mandatory startup cycles between extensions.
- **Initialize KV, then use it synchronously.** `client.kv.initialize()` may be awaitable while a host hydrates its
  memory buffer. Once initialization completes, KV reads, writes, and removals are synchronous; the host owns ordered
  durable flushing. Identity, session, `canCapture`, and `projectToken` are also synchronous, while capture and requests
  are awaitable and remote-config outcomes are delivered through `onRemoteConfig`.
- **Design for async readiness.** Setup may occur before remote config loads or after events have already been captured.
  Guard work after each `await` so disposal cannot be followed by late installation.
- **Persist through `client.kv`, not globals.** Complete `client.kv.initialize()` during setup before using the
  synchronous buffer. Browser-v1 keys are passed verbatim to persistence. Unknown keys may be captured as event
  properties, collisions can overwrite SDK state, and reset clears them. Use stable extension-owned keys and define
  their exposure policy.
- **browser-common owns shared extensions outright.** SDKs construct shared extensions and call `setup(client)` and
  optional `dispose()`; they do not wrap or subclass extension implementations.

## Event streams

Use `Publisher` for an event stream exposed by an extension. Keep the publisher private and expose only its listener:

```ts
import { Publisher, type Extension, type Listener } from '@posthog/browser-common'

interface FeatureFlagsChange {
    flag: string
    value: string | boolean | undefined
}

export class FeatureFlagsExtension implements Extension {
    readonly name = 'featureFlags'
    private readonly _changes = new Publisher<FeatureFlagsChange>()
    readonly onChange: Listener<FeatureFlagsChange> = this._changes.listener

    setup(): void {}

    dispose(): void {
        this._changes.dispose()
    }
}
```

## Porting from browser-v1

| v1                                                            | Shared extension                                        |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| `instance.capture(e, p)`                                      | `client.capture(e, p)`                                  |
| `instance.get_distinct_id()`                                  | `client.distinctId`                                     |
| `instance.get_property(k)` / `persistence`                    | `client.kv.get(k)`                                      |
| `instance.config.X` (static)                                  | constructor option                                      |
| `instance.config.X` (server-driven)                           | `client.onRemoteConfig(...)`                            |
| `instance.sessionManager.checkAndGetSessionAndWindowId(true)` | `client.session`                                        |
| `instance.is_capturing()`                                     | `client.canCapture`                                     |
| `_addCaptureHook` / observing events                          | `client.onEvent(...)`                                   |
| registering an enricher                                       | `client.registerDynamicEventProperties(fn)`             |
| accessing another installed extension                         | `client.getExtension(MyExtensionToken)`                 |
| `requestRouter.endpointFor(...)` + `_send_request`            | `client.sendRequest(path, init?)`                       |
| snapshot/keepalive send on unload                             | `client.sendRequest(path, { transport: 'sendBeacon' })` |

## Checklist

- [ ] All disposables are released in `dispose()`.
- [ ] Enrichers are synchronous; async data is read during setup.
- [ ] Static configuration is passed through constructor options.
- [ ] Event streams keep publishers private and expose listeners.
- [ ] Tests cover setup, teardown, behavior, and shared global patching or multi-instance behavior.
