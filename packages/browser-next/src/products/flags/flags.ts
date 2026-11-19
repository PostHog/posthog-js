import type { Disposable } from '@posthog/browser-common'
import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import type { FeatureFlagsConfig } from '@posthog/browser-common/feature-flags-config'
import { FeatureFlagsCommonExtension } from '@posthog/browser-common/extension-tokens'
import type { IPostHog } from '../../core/types'
import type { FlagsExtension } from './flags-internal'
import type { FeatureFlagResult, FlagsOptions } from './flags-options'
import { FeatureFlagsExtension, type FeatureFlags } from './flags-token'

export { FeatureFlagsExtension, type FeatureFlags } from './flags-token'
export type {
    EarlyAccessFeature,
    EarlyAccessFeatureCallback,
    EarlyAccessFeatureStage,
    FlagsOptions,
    FlagsCallback,
    FlagsReadOptions,
    FeatureFlagResult,
    FeatureFlagsReloadResult,
} from './flags-options'

/** Statically include feature flags, bypassing the default runtime module load. */
export const flags = (options: FlagsOptions = {}): FeatureFlags => {
    const snapshot = JSON.parse(JSON.stringify(options)) as FlagsOptions
    const config: { -readonly [Key in keyof FeatureFlagsConfig]: FeatureFlagsConfig[Key] } = {
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
    const setupBootstrap = config.bootstrap
    let client: IPostHog | undefined
    let disposed = false
    const subscriptions: Disposable[] = []
    const shared = new PostHogFeatureFlags({ get: () => config })
    // Detached results shared by snapshots and subscriptions, so callers cannot mutate stored payloads.
    const snapshotFlags = (): FeatureFlagResult[] =>
        shared.getAllFeatureFlags().map((result) => ({
            ...result,
            // Match single reads, which report an empty-string variant as disabled.
            enabled: result.variant === '' ? false : result.enabled,
            payload: result.payload === undefined ? undefined : JSON.parse(JSON.stringify(result.payload)),
        }))

    const extension: FlagsExtension = {
        name: FeatureFlagsExtension,
        bindings: { [FeatureFlagsCommonExtension]: shared },
        getSurveyContext: () => ({ remoteEvaluation: !config.featureFlagsDisabled }),
        setup: async (value: IPostHog) => {
            client = value
            await shared.setup(value)
            if (disposed) return
            subscriptions.push(
                value.onIdentify(({ distinctId, previousDistinctId, wasIdentified }) => {
                    if (distinctId !== previousDistinctId) {
                        shared.resetFlagCallReported()
                        if (!wasIdentified) shared.setAnonymousDistinctId(previousDistinctId)
                    }
                    shared.reloadFeatureFlags()
                })
            )
            subscriptions.push(
                value.onChangeProperties(({ set, setOnce, unset }) => {
                    if (set || setOnce)
                        shared.setPersonPropertiesForFlags({ $set: set ?? {}, $set_once: setOnce ?? {} }, false)
                    if (unset) shared.unsetPersonPropertiesForFlags([...unset], false)
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
                value.onGroupsReset(() => {
                    shared.resetGroupPropertiesForFlags()
                    shared.reloadFeatureFlags()
                })
            )
            // An accepted event shows that capture works again, and it has already used its own rate limit token.
            subscriptions.push(value.onEvent(() => shared.sendFlagCallsPendingCapture()))
            subscriptions.push(
                value.onReset(() => {
                    // Flag calls report the setup bootstrap again unless the reset supplies its own.
                    config.bootstrap = setupBootstrap
                    shared.reset()
                    shared.reloadFeatureFlags()
                })
            )
            shared.setPersonPropertiesForFlags({ ...value.initialPersonProperties }, false)
            shared.ensureFlagsLoaded()
        },
        bootstrap: (bootstrap) => {
            if (disposed) return
            config.bootstrap = bootstrap
            try {
                shared.initialize()
            } catch (error) {
                client?.logger.error('Feature flags bootstrap failed', error)
            }
        },
        getFeatureFlag: (key, options) => {
            // Fresh reads wait for an error-free evaluation. The shared `fresh` check instead follows the latest HTTP
            // status, so it accepts quota-limited responses and rejects cached values after a later failed refresh.
            if (disposed || (options?.fresh && !shared.hasLoadedRemoteFlags)) return undefined
            try {
                return shared.getFeatureFlagResult(key, { send_event: options?.sendFeatureFlagEvent ?? true })
            } catch (error) {
                client?.logger.error('Feature flag read failed', error)
                return undefined
            }
        },
        getAllFeatureFlags: () => {
            if (disposed) return []
            try {
                return snapshotFlags()
            } catch (error) {
                client?.logger.error('Feature flags snapshot failed', error)
                return []
            }
        },
        onReloading: (callback) => {
            if (!disposed) {
                try {
                    const unsubscribe = shared.onReloading(() => {
                        if (!disposed) callback()
                    })
                    return { dispose: unsubscribe }
                } catch (error) {
                    client?.logger.error('Feature flags reloading subscription failed', error)
                }
            }
            return { dispose() {} }
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
                        callback(snapshotFlags(), !!context?.errorsLoading)
                    )
                    return { dispose: unsubscribe }
                } catch (error) {
                    client?.logger.error('Feature flags subscription failed', error)
                }
            }
            return { dispose() {} }
        },
        setPersonPropertiesForFlags: (properties, reloadFeatureFlags) => {
            if (disposed) return
            try {
                shared.setPersonPropertiesForFlags(properties, reloadFeatureFlags)
            } catch (error) {
                client?.logger.error('Feature flags person properties update failed', error)
            }
        },
        resetPersonPropertiesForFlags: (reloadFeatureFlags) => {
            if (disposed) return
            try {
                shared.resetPersonPropertiesForFlags(reloadFeatureFlags)
            } catch (error) {
                client?.logger.error('Feature flags person properties reset failed', error)
            }
        },
        setGroupPropertiesForFlags: (propertiesByGroupType, reloadFeatureFlags) => {
            if (disposed) return
            try {
                shared.setGroupPropertiesForFlags(propertiesByGroupType, reloadFeatureFlags)
            } catch (error) {
                client?.logger.error('Feature flags group properties update failed', error)
            }
        },
        resetGroupPropertiesForFlags: (groupType) => {
            if (disposed) return
            try {
                shared.resetGroupPropertiesForFlags(groupType)
            } catch (error) {
                client?.logger.error('Feature flags group properties reset failed', error)
            }
        },
        getEarlyAccessFeatures: (callback, forceReload, stages) => {
            if (disposed) return
            try {
                shared.getEarlyAccessFeatures(
                    (features) => {
                        if (disposed) return
                        try {
                            callback(features)
                        } catch (error) {
                            client?.logger.error('Early access feature callback failed', error)
                        }
                    },
                    forceReload,
                    stages
                )
            } catch (error) {
                client?.logger.error('Early access feature listing failed', error)
            }
        },
        updateEarlyAccessFeatureEnrollment: (key, isEnrolled, stage) => {
            if (disposed) return
            try {
                shared.updateEarlyAccessFeatureEnrollment(key, isEnrolled, stage)
            } catch (error) {
                client?.logger.error('Early access feature enrollment failed', error)
            }
        },
        updateFlags: (values, payloads, settings) => {
            if (disposed) return
            try {
                // Reads decode stored payloads once, as serialized server payloads, so store injected values serialized.
                const serialized =
                    payloads &&
                    Object.fromEntries(Object.entries(payloads).map(([key, payload]) => [key, JSON.stringify(payload)]))
                shared.updateFlags(values, serialized, settings)
            } catch (error) {
                client?.logger.error('Feature flags update failed', error)
            }
        },
        dispose: () => {
            if (disposed) return
            disposed = true
            subscriptions.splice(0).forEach((subscription) => subscription.dispose())
            shared.dispose()
        },
    }
    return extension
}
