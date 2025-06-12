import { useEffect, useState } from 'react'
import { usePostHog } from './usePostHog'

export function useFeatureFlagVariantKey(
    flag: string,
    options?: { groups?: Record<string, string> }
): string | boolean | undefined {
    const client = usePostHog()

    const [featureFlagVariantKey, setFeatureFlagVariantKey] = useState<string | boolean | undefined>(() =>
        client.getFeatureFlag(flag, { send_event: false, ...options })
    )

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureFlagVariantKey(client.getFeatureFlag(flag, { send_event: false, ...options }))
        })
    }, [client, flag, options])

    return featureFlagVariantKey
}
