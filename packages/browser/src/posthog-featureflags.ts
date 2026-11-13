import { PostHogFeatureFlags as SharedFeatureFlags } from '@posthog/browser-common/feature-flags'
import { flagsResponseV4 } from '@posthog/browser-common/flags-response-v4'
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

    /**
     * posthog-js requests the v4 `/flags` response, which carries one typed value per flag plus its
     * reason and rule metadata. A server that does not serve v4 answers with the v2 response, which
     * is read as before. Other clients of the shared extension keep `v=2`.
     */
    protected override get _responseFormat() {
        return flagsResponseV4
    }

    updateConfig(config: PostHogConfig, remoteRequestsDisabled: boolean): void {
        this._mutableConfigSource.update(config, remoteRequestsDisabled)
        this._onConfigUpdated()
    }
}
