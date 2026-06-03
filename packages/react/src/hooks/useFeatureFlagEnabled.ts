import { useContext, useEffect, useState } from 'react'
import { PostHogContext } from '../context'
import { isUndefined } from '../utils/type-utils'

/**
 * Check whether a feature flag is enabled for the current user.
 *
 * Returns `undefined` while flags are still loading or when the flag is absent, so callers can
 * distinguish "not known yet" from "disabled".
 *
 * @param flag Key of the feature flag.
 * @returns Whether the flag is enabled, or `undefined` if not yet loaded or not found.
 */
export function useFeatureFlagEnabled(flag: string): boolean | undefined
/**
 * Check whether a feature flag is enabled for the current user.
 *
 * @param flag Key of the feature flag.
 * @param defaultValue Returned instead of `undefined` while flags are loading or when the flag is absent.
 * @returns Whether the flag is enabled, falling back to `defaultValue` when the value is unknown.
 */
export function useFeatureFlagEnabled(flag: string, defaultValue: boolean): boolean
export function useFeatureFlagEnabled(flag: string, defaultValue?: boolean): boolean | undefined {
    const { client, bootstrap } = useContext(PostHogContext)

    const [featureEnabled, setFeatureEnabled] = useState<boolean | undefined>(() => client.isFeatureEnabled(flag))

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureEnabled(client.isFeatureEnabled(flag))
        })
    }, [client, flag])

    const bootstrapped = bootstrap?.featureFlags?.[flag]

    // if the client is not loaded yet, check if we have a bootstrapped value and then true/false it
    if (!client?.featureFlags?.hasLoadedFlags && bootstrap?.featureFlags) {
        return isUndefined(bootstrapped) ? defaultValue : !!bootstrapped
    }

    // while the flag value is unknown (flags not loaded, or the flag is absent), fall back to defaultValue
    return isUndefined(featureEnabled) ? defaultValue : featureEnabled
}
