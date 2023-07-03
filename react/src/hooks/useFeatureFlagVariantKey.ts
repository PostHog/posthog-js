import { usePostHog } from './usePostHog'
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect'
import { SsrStateOptions, useSsrSafeState } from './useSsrSafeState'
import { useCallback } from 'react'

export function useFeatureFlagVariantKey(flag: string, options?: SsrStateOptions): string | boolean | undefined {
    const client = usePostHog()

    const [featureFlagVariantKey, setFeatureFlagVariantKey] = useSsrSafeState<string | boolean | undefined>(
        useCallback(() => client.getFeatureFlag(flag), [client, flag]),
        options
    )
    // would be nice to have a default value above however it's not possible due
    // to a hydration error when using nextjs

    useIsomorphicLayoutEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureFlagVariantKey(client.getFeatureFlag(flag))
        })
    }, [client, flag])

    return featureFlagVariantKey
}
