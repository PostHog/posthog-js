import { useEffect, useState } from 'react'
import { JsonType } from 'posthog-js'
import { usePostHog } from './usePostHog'

export function useFeatureFlag<T = JsonType>(flag: string): T | undefined {
    const client = usePostHog()

    const [flagValue, setFlagValue] = useState<T | undefined>()
    // would be nice to have a default value above however it's not possible due
    // to a hydration error when using nextjs

    useEffect(() => {
        if (!client) {
            return
        }
        return client.onFeatureFlags(() => {
            if (client.getFeatureFlagPayload(flag)) {
                setFlagValue(client.getFeatureFlagPayload(flag) as unknown as T | undefined)
            } else {
                setFlagValue(client.getFeatureFlag(flag) as unknown as T | undefined)
            }
        })
    }, [client, flag])

    return flagValue
}
