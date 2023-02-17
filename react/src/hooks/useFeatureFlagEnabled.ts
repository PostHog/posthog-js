import { useEffect, useState } from 'react'
import { usePostHog } from './usePostHog'

export function useFeatureFlagEnabled(flag: string): string | boolean | undefined {
    const client = usePostHog()

    const [isEnabled, setIsEnabled] = useState<boolean | string | undefined>()
    // would be nice to have a default value above however it's not possible due
    // to a hydration error when using nextjs

    useEffect(() => {
        if (!client) {
            return
        }
        return client.onFeatureFlags(() => {
            setIsEnabled(client.isFeatureEnabled(flag))
        })
    }, [client, flag])

    return isEnabled
}
