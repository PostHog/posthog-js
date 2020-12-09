import { useEffect, useCallback } from 'react'
import { usePostHogContext, FeatureFlags } from '../context'

interface UseFeatureFlagsProps {
    refreshInterval: number
    sendEvent: boolean
}

/**
 * A hook that fetches active feature flags and determines which flags are enabled for the user.
 * @param {number} props.refreshInterval - How often to refresh the feature flags, in seconds.
 * @param {boolean} props.sendEvent - A flag that controls whether an event will be sent on flag refresh.
 * @returns {FeatureFlags['enabled']} An object containing flags that are enabled for the user.
 */
export function useFeatureFlags(props: UseFeatureFlagsProps): FeatureFlags['enabled'] {
    const { refreshInterval = 0, sendEvent = true } = props || {}
    const { client: posthog, featureFlags, setFeatureFlags } = usePostHogContext()

    const getFeatureFlags = useCallback((): void => {
        if (posthog) {
            const active = featureFlags.active || posthog.featureFlags.getFlags()

            const enabled = active.reduce((result: FeatureFlags['enabled'], flag: string) => {
                result[flag] = !!posthog.isFeatureEnabled(flag, {
                    send_event: sendEvent,
                })
                return result
            }, {})

            setFeatureFlags({ active, enabled })
        }
    }, [posthog, featureFlags.active, sendEvent, setFeatureFlags])

    useEffect(() => {
        if (posthog && !featureFlags.active) getFeatureFlags()
    }, [posthog, featureFlags.active, getFeatureFlags])

    useEffect(() => {
        if (refreshInterval > 0) {
            const interval = setInterval(() => {
                getFeatureFlags()
            }, refreshInterval * 1000)
            return () => clearInterval(interval)
        }
    }, [refreshInterval, getFeatureFlags])

    return featureFlags.enabled
}
