import type { Disposable, Extension } from '@posthog/browser-common'
import type { FeatureFlagResult, FlagsCallback, JsonType } from './flags-options'
import type { StorageLike } from './types'

/** Package-private capabilities; flags own persistence and evaluation policy. */
export interface FlagsHost {
    storage: StorageLike | undefined
    key: string
    observeNativeStorage: boolean
}

export interface FlagsExtension extends Extension {
    initialize(host: FlagsHost): void
    getFeatureFlag(key: string): FeatureFlagResult | undefined
    onFeatureFlags(callback: FlagsCallback): Disposable
    updateFlags(
        flags: Record<string, boolean | string>,
        payloads?: Record<string, JsonType>,
        options?: { merge?: boolean }
    ): void
    identify(
        previousDistinctId: string,
        wasIdentified: boolean,
        set?: Record<string, unknown>,
        setOnce?: Record<string, unknown>
    ): void
    group(type: string, changed: boolean, properties?: Record<string, unknown>): void
    reset(): void
}
