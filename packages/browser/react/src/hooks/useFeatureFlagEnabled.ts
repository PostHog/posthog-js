import { useEffect, useState } from 'react'
import { usePostHog } from './usePostHog'

export function useFeatureFlagEnabled(flag: string): boolean | undefined {
    const client = usePostHog()

    const [featureEnabled, setFeatureEnabled] = useState<boolean | undefined>(() => client.isFeatureEnabled(flag))

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureEnabled(client.isFeatureEnabled(flag))
        })
    }, [client, flag])

    return featureEnabled
}
