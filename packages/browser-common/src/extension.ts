import type { Disposable } from './disposable'
import type { Client } from './client'
import type { ExtensionToken } from './token'

/**
 * A shared browser extension. The client calls only two things: `setup(client)`
 * to start it and `dispose()` (from {@link Disposable}) to stop it. Everything
 * an extension consumes flows the other way, through {@link Client}.
 *
 * `setup` may be async so an extension can read async-KV state or remote config
 * before it is ready; the client awaits it. `name` is used for de-duplication
 * and diagnostics. The `Disposable`s an extension creates in `setup` —
 * enrichers, event listeners, timers — are its own to release: hold them and
 * dispose them in `dispose`. The host disposes the extension; it does not track
 * the extension's individual subscriptions.
 *
 * An extension that exposes app-facing controls extends `Extension` with named
 * methods that share its state, e.g.:
 *
 * ```ts
 * interface SessionReplayExtension extends Extension {
 *     startRecording(): void
 *     stopRecording(): void
 *     isActive(): boolean
 * }
 * ```
 *
 * The client still only calls `setup` and `dispose`; the controls are for the
 * application that constructed the extension.
 */
export interface Extension extends Disposable {
    /** Stable extension name used for diagnostics and de-duplication within a client instance. */
    readonly name: string
    /**
     * Capability tokens this extension answers to, so others can resolve it via
     * `client.getExtension(token)`. The extension must be assignable to each
     * token's provided type. Most extensions provide nothing.
     */
    readonly provides?: readonly ExtensionToken<unknown>[]
    /**
     * Start the extension with the host client's capability surface. Called once
     * after construction; return a promise when setup needs asynchronous state
     * such as persisted data or remote config.
     */
    setup(client: Client): void | Promise<void>
}
