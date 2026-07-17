import type { PostHog } from '../posthog-core'
import type { RemoteConfigResult } from '../types'

export type ExtensionConstructor<T extends Extension> = new (instance: PostHog, ...args: any[]) => T

export interface Extension {
    initialize?(): boolean | void
    /**
     * Receives the full remote config fetch result. Handlers must narrow on
     * `result.ok` before reading config fields, and encode their failure
     * behavior explicitly in the `!result.ok` branch.
     */
    onRemoteConfig?(result: RemoteConfigResult): void
}
