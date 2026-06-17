---
name: author-extension
description: Author a new PostHog browser extension, or port a posthog-js v1 extension, against the @posthog/browser-extensions Client/Extension contract. Use when adding or porting an extension (autocapture, pageview, surveys, replay, exceptions, web-vitals, campaign-params, feature flags, …).
---

# Authoring a browser extension

A browser extension is an opt-in feature (autocapture, replay, surveys, …) that
plugs into a host SDK through one contract: it implements `Extension` and talks
to the host only through the `Client` it is handed. The same extension runs on
both posthog-js v1 (synchronous, statically registered) and v2 (asynchronous,
dynamically loaded) — you write it once, against `Client`.

The package is source-only: there is no emitted JS build to import. Consumers are
responsible for bundling/transpiling the TypeScript sources they use.

## The shape

```ts
import type { Extension } from '@posthog/browser-extensions'

export function myExtension(options: MyOptions = {}): Extension {
    return {
        name: 'myExtension',
        setup(client) {
            // wire up capabilities here; keep any Disposables you create
        },
        dispose() {
            // dispose anything you created in setup
        },
    }
}
```

- `name` — unique; used for de-duplication and diagnostics.
- `setup(client)` — may be `async` so you can read async state (kv, remote
  config) before the extension is ready; the host awaits it.
- `dispose()` — may be `async` (final flush, etc.); the host awaits it on
  teardown.
- Static config the app sets goes in your **factory options** (`myExtension({…})`),
  not on the `Client`.

## `Client` — what you get, and when to use it

| Need                                                        | Use                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| current identity                                            | `client.distinctId`, `client.anonymousId`, `client.groups` (sync reads)           |
| current session                                             | `client.session` (sync; `{ sessionId, windowId, sessionStartTimestamp }`)         |
| record an event                                             | `await client.capture(event, properties?, options?)`                              |
| add properties to **every** event                           | `client.registerDynamicEventProperties(() => ({ … }))`                            |
| **react** to events others capture                          | `client.onEvent(({ event, properties }) => …)`                                    |
| call a PostHog endpoint (`/s/`, `/flags/`, `/api/surveys/`) | `await client.apiRequest(path, init?)`                                            |
| server config (decide/flags response)                       | `await client.getRemoteConfig()` (current) / `client.onRemoteConfig(…)` (changes) |
| react to a new session / reset                              | `client.onNewSession(({ reason, … }) => …)`                                       |
| use another extension                                       | `client.getExtension(SomeToken)`                                                  |
| persist small state                                         | `client.kv` (async `get`/`set`/`remove`, namespaced to you)                       |
| log                                                         | `client.logger`                                                                   |

## Hard rules

- **Enrichers are synchronous.** `registerDynamicEventProperties(producer)` runs
  inline while the host builds an event — it must not `await`. If you need
  persisted/async data, read it in `setup` and close over the result.
- **Enrich = add; observe = react.** `registerDynamicEventProperties` _contributes_
  properties to events. `onEvent` _watches_ finalized events and reacts (it can't
  change them). Dropping/rewriting whole events is the host's `beforeSend`, not
  an extension's job.
- **Do not drop disposables.** Anything returned from `onEvent`,
  `registerDynamicEventProperties`, `onNewSession`, another `Listener`, or a
  timer wrapper must be stored and disposed in your `dispose()`.
- **Reads are sync, I/O is async.** Identity and session are synchronous
  in-memory reads. `capture`, `apiRequest`, `kv`, `getRemoteConfig` are async.
- **Design for async readiness.** Your extension may be set up _after_ events
  have already been captured (dynamic loading) or before flags/remote-config have
  loaded. Never assume you saw the first event or that data is present at `setup`;
  `await client.getRemoteConfig()` / the providing extension's reads resolve once
  ready.
- **Persist through `client.kv`, not globals.** It is namespaced to your
  extension; JSON-serializable values only; `null`/`undefined` removes a key.

## Providing a capability to other extensions

If your extension exposes something others depend on (e.g. feature flags),
declare a token + interface and list it in `provides`. Use `Publisher` for any
event stream you expose: keep the publisher private, expose its `listener`.

```ts
// flags/token.ts — implementation-free, importable without pulling flags' code
import type { Extension, ExtensionToken, Listener } from '@posthog/browser-extensions'

export interface FeatureFlagsChange {
    flag: string
    value: string | boolean | undefined
}

export interface FeatureFlagsExtension extends Extension {
    getFeatureFlag(key: string): Promise<string | boolean | undefined>
    onChange: Listener<FeatureFlagsChange>
}

export const FeatureFlags: ExtensionToken<FeatureFlagsExtension> = { name: 'featureFlags' }
```

```ts
// flags/index.ts
import { Publisher } from '@posthog/browser-extensions'
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

The extension must be assignable to each token's type (the registry casts on
lookup — the compiler does not check this for you).

## Depending on another extension

Resolve by token; handle absence (it may not be installed or loaded yet):

```ts
import { FeatureFlags } from './flags/token'

setup(client) {
    const flags = client.getExtension(FeatureFlags)
    if (flags && (await flags.getFeatureFlag('my-flag'))) { … }
}
```

Import the **token** (and the interface type), never the providing extension's
implementation — that keeps your chunk free of its code and keeps it lazily
loadable.

## Tree-shaking

- Keep token modules implementation-free.
- Where extension subpath exports exist, expose one subpath per extension.
- Cross-extension references go through token modules only.
- Don't statically import another extension's implementation.

## Porting from v1

Map v1's reach-into-`this._instance` calls onto `Client`:

| v1                                                            | Client                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| `instance.capture(e, p)`                                      | `client.capture(e, p)`                                 |
| `instance.get_distinct_id()`                                  | `client.distinctId` (sync)                             |
| `instance.get_property(k)` / `persistence`                    | `client.kv.get(k)` (async)                             |
| `instance.config.X` (static)                                  | factory option                                         |
| `instance.config.X` (server-driven)                           | `client.getRemoteConfig()` / `onRemoteConfig`          |
| `instance.sessionManager.checkAndGetSessionAndWindowId(true)` | `client.session` (sync)                                |
| `_addCaptureHook` / observing events                          | `client.onEvent(...)`                                  |
| returned unregister / subscription disposables                | store and dispose in `dispose()`                       |
| `instance.onFeatureFlags(cb)`                                 | `client.getExtension(FeatureFlags)?.onChange(cb)`      |
| `instance.featureFlags.getFeatureFlag(k)`                     | `client.getExtension(FeatureFlags)?.getFeatureFlag(k)` |
| registering an enricher                                       | `client.registerDynamicEventProperties(fn)`            |
| `requestRouter.endpointFor(...)` + `_send_request`            | `client.apiRequest(path, init?)`                       |
| snapshot/keepalive send on unload                             | `client.apiRequest(path, { unload: true })`            |

## Checklist

- [ ] Factory returns an `Extension` (`name`, `setup`, `dispose`); static config via options.
- [ ] `Disposable`s created in `setup` are released in `dispose`.
- [ ] Enrichers are synchronous; async data read in `setup`.
- [ ] Cross-extension deps via `getExtension(token)`, undefined handled.
- [ ] If you provide a capability: token + interface defined, listed in `provides`.
- [ ] If you expose an event stream: private `Publisher`, public `publisher.listener`.
- [ ] No static import of another extension's implementation.
- [ ] Own subpath export added when the package has a public extension entrypoint.
- [ ] Tests cover setup, teardown, and behavior.

## Not yet established (fill in from the first port)

These are intentionally TBD until a real extension is ported; update this skill
when they are:

- **Canonical file/dir layout** for an extension within the package.
- **Test harness** — a `createTestClient()` fake `Client` to author and assert
  against (to be shipped from the package).
- **v1 adapter mechanics** — exactly how a shared extension is registered into
  v1's static `__extensionClasses` model.
- **Reference extension** — the first ported extension to copy from.
- **Known gotchas** discovered during porting.
