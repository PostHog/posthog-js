# @posthog/browser-common

Internal shared browser utilities and extension primitives for PostHog JavaScript
SDKs. This package is published so unbundled SDK outputs can resolve it at
runtime, but it is not a public API surface and does not provide compatibility
guarantees outside PostHog SDK packages.

The shared extension contract includes the interface an extension implements
(`Extension`), the host adapter it receives (`Client`), and small shared runtime
primitives such as `Publisher`.

This contract is designed so an extension can run unchanged across major
versions of the web SDK. Concrete host adapters remain owned by their SDK
packages; browser-v1 and browser-v2 composition and loading integration are
separate from this shared runtime.

## Concepts

### `Extension`

What you implement. The host calls `setup` once and optional `dispose` for final cleanup:

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

`setup(client)` may be async to read state before the extension is ready. Async
extensions must guard work after each `await` so cleanup cannot be followed by
late listener or timer installation. `dispose()` is synchronous, optional,
idempotent, and best-effort. Static app config goes in the constructor, not on
`Client`.

Anything in `setup` that returns a `Disposable` must be held by the extension
and disposed in `dispose()`. Use `createDisposable(teardown)` when adapting a
synchronous callback into idempotent teardown.

### `Client`

What an extension is given in `setup` — the adapter shared by extensions on that host SDK instance:

- **identity and session**: `distinctId`, `anonymousId`, `groups`, `session`
- **events**: `capture(...)`, `registerDynamicEventProperties(...)`, `onEvent(...)`
- **server config**: `getRemoteConfig()` and `onRemoteConfig(...)`
- **transport**: `projectToken`, `sendRequest(path, init?)`
- **storage and logging**: `kv`, `logger`

Identity, session, and the public project token are always-ready synchronous
reads. Operations that may perform I/O, including `capture`, `sendRequest`,
`kv`, and `getRemoteConfig`, are awaitable. Extensions that want a named log
prefix can create a child with `client.logger.createLogger('[myExtension]')`.

### Host runtime

PostHog browser SDK implementations share extension registration and teardown
through `ExtensionRuntime`, imported from the dedicated
`@posthog/browser-common/extension-runtime` subpath. It reserves extension names
during setup, rolls back failed setup, and disposes extensions once in reverse
registration order without waiting for pending setup. Concrete SDKs still own
their `Client` adapter and SDK lifecycle hooks.

`ExtensionRuntime` is host infrastructure, not part of the extension-author
surface exported from the package root.

### `Publisher`

Use `Publisher<T>` when an extension exposes an event stream. Keep the publisher
private, expose only its listener, and dispose it with the extension:

```ts
import { Publisher, type Listener } from '@posthog/browser-common'

const changes = new Publisher<{ enabled: boolean }>()
export const onChange: Listener<{ enabled: boolean }> = changes.listener

changes.publish({ enabled: true })
changes.dispose()
```

## Utilities

Reusable browser utilities are exposed through `utils/*` subpaths, but they are
intentionally not re-exported from the package root or a utility barrel. Import
the exact file needed so lazy extension bundles do not pull in unrelated helpers:

```ts
import { createLogger } from '@posthog/browser-common/utils/logger'
import { formDataToQuery } from '@posthog/browser-common/utils/request-utils'
```

## Authoring

See the **`develop-extension`** skill
([`.agents/skills/develop-extension/SKILL.md`](./.agents/skills/develop-extension/SKILL.md))
for the complete authoring and browser-v1 porting guide.

## Status

Early and internal. The package currently defines the extension and client
contracts, a shared host runtime, lifecycle helpers, and directly imported
browser utilities under `utils/*` subpaths.
