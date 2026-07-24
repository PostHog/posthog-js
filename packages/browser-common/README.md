# @posthog/browser-common

Internal shared browser utilities and extension primitives for PostHog JavaScript
SDKs. This package is published so unbundled SDK outputs can resolve it at
runtime, but it is not a public API surface and does not provide compatibility
guarantees outside PostHog SDK packages.

The shared extension contract includes the interface an extension implements
(`Extension`), the host services it is handed (`Client`), the core analytics
capability (`CoreExtension`), and small shared runtime primitives such as
`Publisher`.

This contract is designed so an extension can run unchanged across major
versions of the web SDK. Concrete host adapters remain owned by their SDK
packages; browser-v1 and browser-v2 composition and loading integration are
separate from this shared runtime.

A conforming SDK provides a _client adapter_ that implements `Client` over its
own internals, so extension code never depends on a specific SDK.

## Concepts

### `Extension`

What you implement. The host calls only `setup` and `dispose`:

```ts
import { CoreExtension, type Disposable, type Extension } from '@posthog/browser-common'

export function webContext(): Extension {
    let removeProperties: Disposable | undefined

    return {
        name: 'webContext',
        setup(client) {
            const core = client.getExtension(CoreExtension)
            if (!core) {
                throw new Error('CoreExtension is required')
            }
            removeProperties = core.registerDynamicEventProperties(() => ({
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
and disposed in `dispose()`. Use `createDisposable(teardown)` when adapting a
callback into idempotent teardown.

### `Client`

What an extension is given in `setup` — the host's extension services:

- **transport**: `apiRequest(path, init?)`
- **registry**: `getExtension(token)`
- **storage & logging**: `kv`, `logger`

### `CoreExtension`

A conforming host must register one `CoreExtension` before setting up product
extensions. Resolve it through `client.getExtension(CoreExtension)` for behavior
owned by the PostHog client's analytics core:

- **identity & session**: `distinctId`, `anonymousId`, `groups`, `session`
- **events**: `capture(...)`, `registerDynamicEventProperties(...)`, `onEvent(...)`
- **lifecycle**: `onNewSession(...)`
- **server config**: `getRemoteConfig()` (current), `onRemoteConfig(...)` (changes)

Identity and session are always-ready synchronous reads. Operations that perform
I/O, including `capture`, `apiRequest`, `kv`, and `getRemoteConfig`, are
awaitable.

### Host runtime

PostHog browser SDK implementations share extension registration and teardown
through `ExtensionRuntime`, imported from the dedicated
`@posthog/browser-common/extension-runtime` subpath. It reserves names and
capability tokens during setup, publishes providers only after successful
readiness, and disposes extensions once in reverse registration order. Concrete
SDKs still own the `Client` adapter, Core implementation, and SDK lifecycle
hooks.

`ExtensionRuntime` is host infrastructure, not part of the extension-author
surface exported from the package root.

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

A token is an implementation-free branded string, so importing it never pulls
the provider's code into your bundle — each extension stays independently
tree-shakable and lazily loadable. Use a package-qualified runtime string, such
as `posthog.featureFlags`, that is globally unique and stable so separately
compiled scripts resolve the same capability. An extension that provides a
capability declares its token(s) in `provides`.

## Utilities

Reusable browser utilities are exposed through `utils/*` subpaths, but they are
intentionally not re-exported from the package root or a utility barrel. Import
the exact file you need so lazy extension bundles do not pull in unrelated
helpers:

```ts
import { createLogger } from '@posthog/browser-common/utils/logger'
import { formDataToQuery } from '@posthog/browser-common/utils/request-utils'
```

## Authoring

See the **`develop-extension`** skill
([`.agents/skills/develop-extension/SKILL.md`](./.agents/skills/develop-extension/SKILL.md))
for the full guide: the capability cheatsheet, the rules (enrichers are
synchronous, dispose your disposables, design for asynchronous readiness,
cross-extension state goes through `getExtension`, not shared storage), and the
v1 → `Client` porting map.

## Status

Early and internal. The package currently defines the extension contract, the
core analytics capability, a shared host runtime, shared lifecycle helpers, and
directly imported browser utilities under `utils/*` subpaths.
