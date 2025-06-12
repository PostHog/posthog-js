import { useEffect, useState } from 'react'
import { usePostHog } from './usePostHog'

export function useFeatureFlagEnabled(
    flag: string,
    options?: { groups?: Record<string, string> }
): boolean | undefined {
    const client = usePostHog()

    const [featureEnabled, setFeatureEnabled] = useState<boolean | undefined>(() => 
        !!client.getFeatureFlag(flag, { send_event: false, ...options })
    )

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureEnabled(!!client.getFeatureFlag(flag, { send_event: false, ...options }))
        })
    }, [client, flag, options])

    return featureEnabled
}
