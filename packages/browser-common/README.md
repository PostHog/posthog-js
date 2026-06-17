# @posthog/browser-common

The shared contract for PostHog browser-SDK extensions: the interface an
extension implements (`Extension`), the host capabilities it is handed
(`Client`), and small shared runtime primitives such as `Publisher`.

An extension written against this contract runs unchanged across major versions of the web SDK:

- **v1** is synchronous; extensions are registered statically.
- **v2** is asynchronous; extensions are loaded dynamically.

Each SDK provides a _client adapter_ that implements `Client` over its own
internals, so extension code never depends on a specific SDK.

This is a source-only package: it does not publish built output. Consumers are
responsible for bundling/transpiling the TypeScript sources they import.

## Concepts

### `Extension`

What you implement. The host calls only `setup` and `dispose`:

```ts
import type { Disposable, Extension } from '@posthog/browser-common'

export function webContext(): Extension {
    let removeProperties: Disposable | undefined

    return {
        name: 'webContext',
        setup(client) {
            removeProperties = client.registerDynamicEventProperties(() => ({
                $current_url: window.location.href,
            }))
        },
        dispose() {
            removeProperties?.dispose()
        },
    }
}
```

`setup(client)` may be async (read async state before you're ready); `dispose()`
may be async (final flush). Static config the app sets goes in your constructor,
not on the `Client`.

Anything in `setup` that returns a `Disposable` must be held by the extension
and disposed in `dispose()`.

### `Client`

What an extension is given in `setup` — the host's capability surface:

- **identity & session** (synchronous reads): `distinctId`, `anonymousId`, `groups`, `session`
- **events**: `capture(...)`, `registerDynamicEventProperties(...)` (contribute properties), `onEvent(...)` (observe)
- **transport**: `apiRequest(path, init?)`
- **server config**: `getRemoteConfig()` (current), `onRemoteConfig(...)` (changes)
- **lifecycle**: `onNewSession(...)`
- **registry**: `getExtension(token)`
- **storage & logging**: `kv`, `logger`

Synchronous members are always-ready in-memory reads; everything that does I/O
or waits for readiness (`capture`, `apiRequest`, `kv`, `getRemoteConfig`) is
asynchronous.

### `Publisher`

Use `Publisher<T>` when an extension provides its own event stream to other
extensions or to app-facing controls. Keep the publisher private, expose only its
`listener`, and dispose it when the extension is torn down:

```ts
import { Publisher, type Listener } from '@posthog/browser-common'

const changes = new Publisher<FeatureFlagsChange>()

export const onChange: Listener<FeatureFlagsChange> = changes.listener

changes.publish({ flag: 'beta-ui', value: true })
changes.dispose()
```

## Cross-extension dependencies

Extensions depend on one another through tokens, never implementation imports:

```ts
import { FeatureFlags } from './feature-flags/token'

const flags = client.getExtension(FeatureFlags) // FeatureFlagsExtension | undefined
if (flags && (await flags.getFeatureFlag('beta-ui'))) {
    /* … */
}
```

A token is implementation-free, so importing it never pulls the provider's code
into your bundle — each extension stays independently tree-shakable and lazily
loadable. An extension that provides a capability declares its token(s) in
`provides`.

## Authoring

See the **`develop-extension`** skill
([`.agents/skills/develop-extension/SKILL.md`](./.agents/skills/develop-extension/SKILL.md))
for the full guide: the capability cheatsheet, the rules (enrichers are
synchronous, dispose your disposables, design for asynchronous readiness,
cross-extension state goes through `getExtension`, not shared storage), and the
v1 → `Client` porting map.

## Status

Early. The package currently defines the extension contract and the shared
`Publisher` helper. Additional shared runtime helpers — key-value stores, the
registry implementation, and a test `Client` — will land alongside the first
ported extension.
