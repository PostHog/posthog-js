import { useEffect, useCallback } from 'react'
import { usePostHogContext, FeatureFlags } from '../context'

/**
 * A hook that fetches active feature flags and determines which flags are enabled for the user.
 * @param props.refreshInterval - How often to refresh the feature flags, in seconds.
 * @param props.sendEvent - A flag that controls whether an event will be sent on flag refresh.
 * @returns An object containing active flags and flags that are enabled for the user.
 */
export function useFeatureFlags(props: { refreshInterval: number; sendEvent: boolean }): FeatureFlags {
    const { refreshInterval = 0, sendEvent = true } = props || {}
    const { client: posthog, featureFlags, setFeatureFlags } = usePostHogContext()

    const getEnabledFlags = useCallback(
        (flags): void => {
            const enabled = flags.reduce((result: FeatureFlags['enabled'], flag: string) => {
                result[flag] = !!posthog?.isFeatureEnabled(flag, {
                    send_event: sendEvent,
                })
                return result
            }, {})
            setFeatureFlags({ active: flags, enabled })
        },
        [posthog, sendEvent, setFeatureFlags]
    )

    useEffect(() => {
        if (posthog && refreshInterval > 0) {
            const interval = setInterval(() => {
                posthog?.featureFlags.reloadFeatureFlags()
            }, refreshInterval * 1000)
            return () => clearInterval(interval)
        }
    }, [posthog, refreshInterval, getEnabledFlags])

    useEffect(() => {
        posthog?.onFeatureFlags(getEnabledFlags)
    }, [posthog, getEnabledFlags])

    return featureFlags
}
