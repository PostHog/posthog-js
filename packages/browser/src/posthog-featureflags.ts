import { PostHogFeatureFlags as SharedFeatureFlags } from '@posthog/browser-common/feature-flags'
import type { PostHog } from './posthog-core'
import type { PostHogConfig } from './types'
import { MutableFeatureFlagsConfigSource } from './feature-flags-config'
import { FeatureFlagsExtension } from './extension-tokens'

export {
    FeatureFlagError,
    filterActiveFeatureFlags,
    parseFlagsResponse,
    QuotaLimitedResource,
} from '@posthog/browser-common/feature-flags'

/** Legacy constructor and configuration mapping for the shared flags extension. */
export class PostHogFeatureFlags extends SharedFeatureFlags {
    override readonly name = FeatureFlagsExtension
    private readonly _mutableConfigSource: MutableFeatureFlagsConfigSource
    private readonly _instance: PostHog

    constructor(instance: PostHog) {
        const mutableConfigSource = new MutableFeatureFlagsConfigSource(instance.config, instance._shouldDisableFlags())
        super(mutableConfigSource)
        this._instance = instance
        this._mutableConfigSource = mutableConfigSource
    }

    protected override get _crossTabPersistence() {
        return this._instance.persistence
    }

    updateConfig(config: PostHogConfig, remoteRequestsDisabled: boolean): void {
        this._mutableConfigSource.update(config, remoteRequestsDisabled)
        this._onConfigUpdated()
    }
}
