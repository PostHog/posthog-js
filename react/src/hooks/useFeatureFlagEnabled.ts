import { useEffect, useState } from 'react'
import { usePostHog } from './usePostHog'

export function useFeatureFlagEnabled(flag: string): boolean | undefined {
    const client = usePostHog()

    const [featureEnabled, setFeatureEnabled] = useState<boolean | undefined>()
    // would be nice to have a default value above however it's not possible due
    // to a hydration error when using nextjs. Instead, we set default value with useEffect
    // which is only run on the client
    useEffect(() => {
        setFeatureEnabled(client.isFeatureEnabled(flag))
    }, [])

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureEnabled(client.isFeatureEnabled(flag))
        })
    }, [client, flag])

    return featureEnabled
}
