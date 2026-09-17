import type { Client, Extension } from '@posthog/browser-common'
import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import type { FeatureFlagsConfig } from '@posthog/browser-common/feature-flags-config'
import type { FlagsExtension } from './flags-internal'
import type { FlagsOptions } from './flags-options'

export type { FlagsOptions, FlagsCallback, FeatureFlagResult } from './flags-options'

/** Statically include feature flags, bypassing the default runtime module load. */
export const flags = (options: FlagsOptions = {}): Extension => {
    const snapshot = JSON.parse(JSON.stringify(options)) as FlagsOptions
    const config: FeatureFlagsConfig = {
        bootstrap: snapshot.bootstrap ?? {},
        remoteRequestsDisabled: false,
        featureFlagsDisabled: snapshot.featureFlagEvaluation === false,
        onlyEvaluateSurveyFeatureFlags: snapshot.onlyEvaluateSurveyFeatureFlags ?? false,
        deduplicateCallsPerSession: snapshot.deduplicateCallsPerSession ?? false,
        ...(snapshot.cacheTtlMs === undefined ? {} : { cacheTtlMs: snapshot.cacheTtlMs }),
        refreshIntervalMs: snapshot.featureFlagEvaluation === false ? 0 : (snapshot.refreshIntervalMs ?? 300_000),
        idleRefreshBackoff: snapshot.refreshIntervalMs === undefined,
        requestTimeoutMs: snapshot.requestTimeoutMs ?? 3000,
        evaluationContexts: snapshot.evaluationContexts ?? [],
        ...(snapshot.flagKeys === undefined ? {} : { flagKeys: snapshot.flagKeys }),
    }
    let client: Client | undefined
    let disposed = false
    const shared = new PostHogFeatureFlags({ get: () => config })

    const extension: FlagsExtension = {
        name: 'featureFlags',
        setup: async (value) => {
            client = value
            await shared.setup(value)
            if (disposed) {
                shared.dispose()
                return
            }
            shared.setPersonPropertiesForFlags({ ...value.initialPersonProperties }, false)
            shared.ensureFlagsLoaded()
        },
        getFeatureFlag: (key) => (disposed ? undefined : shared.getFeatureFlagResult(key)),
        onFeatureFlags: (callback) => {
            if (disposed) return { dispose() {} }
            const unsubscribe = shared.onFeatureFlags((_keys, _variants, context) =>
                callback(shared.getAllFeatureFlags(), !!context?.errorsLoading)
            )
            return { dispose: unsubscribe }
        },
        updateFlags: (values, payloads, settings) => {
            if (!disposed) shared.updateFlags(values, payloads, settings)
        },
        onIdentify: (previousDistinctId, wasIdentified, set, setOnce) => {
            if (client?.distinctId !== previousDistinctId) {
                shared.resetFlagCallReported()
                if (!wasIdentified) shared.setAnonymousDistinctId(previousDistinctId)
            }
            if (set || setOnce) shared.setPersonPropertiesForFlags({ $set: set ?? {}, $set_once: setOnce ?? {} }, false)
            shared.reloadFeatureFlags()
        },
        onGroup: (type, changed, properties) => {
            if (changed) shared.resetGroupPropertiesForFlags(type)
            if (properties) shared.setGroupPropertiesForFlags({ [type]: properties }, false)
            shared.reloadFeatureFlags()
        },
        reset: () => {
            shared.reset()
            shared.reloadFeatureFlags()
        },
        dispose: () => {
            disposed = true
            shared.dispose()
        },
    }
    return extension
}
