import type { PostHog } from '../posthog-core'
import type { RemoteConfig } from '../types'

export type ExtensionConstructor<T extends Extension> = new (instance: PostHog, ...args: any[]) => T

export interface Extension {
    initialize?(): boolean | void
    onRemoteConfig?(config: RemoteConfig): void
    /**
     * Called instead of onRemoteConfig when the remote config could not be fetched.
     * Implement when a server-controlled setting must not fall back to its default
     * on failure; extensions without it receive onRemoteConfig with an empty config.
     */
    onRemoteConfigFailed?(): void
}
