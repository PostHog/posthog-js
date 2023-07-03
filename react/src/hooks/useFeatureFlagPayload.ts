import { JsonType } from 'posthog-js'
import { usePostHog } from './usePostHog'
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect'
import { SsrStateOptions, useSsrSafeState } from './useSsrSafeState'
import { useCallback } from 'react'

export function useFeatureFlagPayload(flag: string, options?: SsrStateOptions): JsonType | undefined {
    const client = usePostHog()

    const [featureFlagPayload, setFeatureFlagPayload] = useSsrSafeState<JsonType>(
        useCallback(() => client.getFeatureFlagPayload(flag), [client, flag]),
        options
    )
    // would be nice to have a default value above however it's not possible due
    // to a hydration error when using nextjs

    useIsomorphicLayoutEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureFlagPayload(client.getFeatureFlagPayload(flag))
        })
    }, [client, flag])

    return featureFlagPayload
}
