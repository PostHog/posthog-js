import { STORED_PERSON_PROPERTIES_KEY } from '@posthog/browser-common/constants'
import type { Disposable } from '@posthog/browser-common'
import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import type { FeatureFlagsConfig } from '@posthog/browser-common/feature-flags-config'
import { FeatureFlagsCommonExtension } from '@posthog/browser-common/extension-tokens'
import type { IPostHogInternal } from '../../core/context/browser-client'
import type { IFeatureFlagsInternal } from './flags-internal'
import type { FeatureFlagsOptions } from './flags-options'
import { FeatureFlagsExtension, type IFeatureFlags } from './flags-token'

export { FeatureFlagsExtension, type IFeatureFlags } from './flags-token'
export type {
    FeatureFlagsOptions,
    FeatureFlagsReadOptions,
    FeatureFlagsCallback,
    FeatureFlagResult,
    FeatureFlagsReloadResult,
} from './flags-options'

/** Statically include feature flags, bypassing the default runtime module load. */
export const featureFlags = (options: FeatureFlagsOptions = {}): IFeatureFlags => {
    const snapshot = JSON.parse(JSON.stringify(options)) as FeatureFlagsOptions
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
    let client: IPostHogInternal | undefined
    let disposed = false
    const subscriptions: Disposable[] = []
    const shared = new PostHogFeatureFlags({ get: () => config })

    const extension: IFeatureFlagsInternal = {
        name: FeatureFlagsExtension,
        bindings: { featureFlags: shared, [FeatureFlagsCommonExtension]: shared },
        getSurveyContext: () => ({
            remoteEvaluation: !config.featureFlagsDisabled,
            personProperties: client?.kv.get(STORED_PERSON_PROPERTIES_KEY),
        }),
        setup: async (value: IPostHogInternal) => {
            client = value
            await value.resolveExtension('analytics')
            if (disposed) return
            await shared.setup(value.sharedClient)
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
                    shared.reset()
                    shared.reloadFeatureFlags()
                })
            )
            shared.setPersonPropertiesForFlags({ ...value.initialPersonProperties }, false)
            shared.ensureFlagsLoaded()
        },
        getFeatureFlag: (key, options) => {
            if (disposed) return undefined
            try {
                return shared.getFeatureFlagResult(key, {
                    send_event: options?.sendFeatureFlagEvent ?? true,
                    fresh: options?.fresh ?? false,
                })
            } catch (error) {
                client?.logger.error('Feature flag read failed', error)
                return undefined
            }
        },
        getAllFeatureFlags: () => {
            if (disposed) return []
            try {
                return shared.getAllFeatureFlags().map((result) => ({
                    ...result,
                    payload: result.payload === undefined ? undefined : JSON.parse(JSON.stringify(result.payload)),
                }))
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
            if (disposed) return
            disposed = true
            subscriptions.splice(0).forEach((subscription) => subscription.dispose())
            shared.dispose()
        },
    }
    return extension
}
