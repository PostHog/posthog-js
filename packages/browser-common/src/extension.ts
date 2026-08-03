import type { Client } from './client'

/**
 * A shared browser extension. The client calls `setup(client)` once to start it
 * and optional `dispose()` once for final best-effort resource cleanup.
 * Everything an extension consumes flows through {@link Client}.
 *
 * `setup` may be async so an extension can read async KV state or remote config
 * before it is ready. Async extensions must guard work after each `await` so
 * cleanup cannot be followed by late listener, timer, or patch installation.
 * The disposables an extension creates in setup are its own to release.
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
 */
export interface Extension {
    /** Stable extension name used for diagnostics and de-duplication within a client instance. */
    readonly name: string
    /**
     * Start the extension with the host client's capability surface. Called once
     * after construction; return a promise when setup needs asynchronous state.
     */
    setup(client: Client): void | Promise<void>
    /** Release final resources synchronously. Feature-level start/stop remains extension-owned. */
    dispose?(): void
}
