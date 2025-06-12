import { useEffect, useState } from 'react'
import { usePostHog } from './usePostHog'

export function useFeatureFlagVariantKey(flag: string): string | boolean | undefined {
    const client = usePostHog()

    const [featureFlagVariantKey, setFeatureFlagVariantKey] = useState<string | boolean | undefined>(() =>
        client.getFeatureFlag(flag)
    )

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureFlagVariantKey(client.getFeatureFlag(flag))
        })
    }, [client, flag])

    return featureFlagVariantKey
}
