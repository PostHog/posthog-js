import type { Disposable } from '@posthog/browser-common'
import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import type { FeatureFlagsConfig } from '@posthog/browser-common/feature-flags-config'
import type { BrowserClient } from './browser-client'
import type { FlagsOptions } from './flags-options'
import { FeatureFlagsExtension, type FeatureFlags } from './flags-token'

export { FeatureFlagsExtension, type FeatureFlags } from './flags-token'
export type { FlagsOptions, FlagsCallback, FeatureFlagResult, FeatureFlagsReloadResult } from './flags-options'

/** Statically include feature flags, bypassing the default runtime module load. */
export const flags = (options: FlagsOptions = {}): FeatureFlags => {
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
    let client: BrowserClient | undefined
    let disposed = false
    const subscriptions: Disposable[] = []
    const shared = new PostHogFeatureFlags({ get: () => config })

    const extension: FeatureFlags & { getActiveFlags(): string[] } = {
        name: FeatureFlagsExtension,
        getActiveFlags: () => (disposed ? [] : shared.getFlags()),
        setup: async (value: BrowserClient) => {
            client = value
            await shared.setup(value)
            if (disposed) {
                shared.dispose()
                return
            }
            subscriptions.push(
                value.onIdentify(({ distinctId, previousDistinctId, wasIdentified, set, setOnce }) => {
                    if (distinctId !== previousDistinctId) {
                        shared.resetFlagCallReported()
                        if (!wasIdentified) shared.setAnonymousDistinctId(previousDistinctId)
                    }
                    if (set || setOnce)
                        shared.setPersonPropertiesForFlags({ $set: set ?? {}, $set_once: setOnce ?? {} }, false)
                    shared.reloadFeatureFlags()
                })
            )
            subscriptions.push(
                value.onGroup(({ type, changed, properties }) => {
                    if (changed) shared.resetGroupPropertiesForFlags(type)
                    if (properties) shared.setGroupPropertiesForFlags({ [type]: properties }, false)
                    shared.reloadFeatureFlags()
                })
            )
            subscriptions.push(
                value.onReset(() => {
                    shared.reset()
                    shared.reloadFeatureFlags()
                })
            )
            shared.setPersonPropertiesForFlags({ ...value.initialPersonProperties }, false)
            shared.ensureFlagsLoaded()
        },
        getFeatureFlag: (key) => {
            if (disposed) return undefined
            try {
                return shared.getFeatureFlagResult(key)
            } catch (error) {
                client?.logger.error('Feature flag read failed', error)
                return undefined
            }
        },
        reloadFeatureFlags: async () => {
            if (disposed) return { status: 'cancelled' }
            try {
                return await shared.reloadFeatureFlagsAsync()
            } catch (error) {
                client?.logger.error('Feature flags reload failed', error)
                return { status: 'error' }
            }
        },
        onFeatureFlags: (callback) => {
            if (!disposed) {
                try {
                    const unsubscribe = shared.onFeatureFlags((_keys, _variants, context) =>
                        callback(shared.getAllFeatureFlags(), !!context?.errorsLoading)
                    )
                    return { dispose: unsubscribe }
                } catch (error) {
                    client?.logger.error('Feature flags subscription failed', error)
                }
            }
            return { dispose() {} }
        },
        updateFlags: (values, payloads, settings) => {
            if (disposed) return
            try {
                shared.updateFlags(values, payloads, settings)
            } catch (error) {
                client?.logger.error('Feature flags update failed', error)
            }
        },
        dispose: () => {
            disposed = true
            subscriptions.splice(0).forEach((subscription) => subscription.dispose())
            shared.dispose()
        },
    }
    return extension
}
