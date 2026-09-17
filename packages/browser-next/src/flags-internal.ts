import type { Disposable, Extension } from '@posthog/browser-common'
import type { FeatureFlagResult, FlagsCallback, JsonType } from './flags-options'

export interface FlagsExtension extends Extension {
    getFeatureFlag(key: string): FeatureFlagResult | undefined
    onFeatureFlags(callback: FlagsCallback): Disposable
    updateFlags(
        flags: Record<string, boolean | string>,
        payloads?: Record<string, JsonType>,
        options?: { merge?: boolean }
    ): void
    onIdentify(
        previousDistinctId: string,
        wasIdentified: boolean,
        set?: Record<string, unknown>,
        setOnce?: Record<string, unknown>
    ): void
    onGroup(type: string, changed: boolean, properties?: Record<string, unknown>): void
    reset(): void
}
