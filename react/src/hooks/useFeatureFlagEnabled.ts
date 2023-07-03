import { usePostHog } from './usePostHog'
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect'
import { SsrStateOptions, useSsrSafeState } from './useSsrSafeState'
import { useCallback } from 'react'

export function useFeatureFlagEnabled(flag: string, options?: SsrStateOptions): boolean | undefined {
    const client = usePostHog()

    const [featureEnabled, setFeatureEnabled] = useSsrSafeState<boolean | undefined>(
        useCallback(() => client.isFeatureEnabled(flag), [client, flag]),
        options
    )

    useIsomorphicLayoutEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureEnabled(client.isFeatureEnabled(flag))
        })
    }, [client, flag])

    return featureEnabled
}
