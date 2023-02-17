import { useEffect, useState } from 'react'
import { JsonType } from 'posthog-js'
import { usePostHog } from './usePostHog'

export function useFeatureFlagPayload(flag: string): JsonType | undefined {
    const client = usePostHog()

    const [featureFlagPayload, setFeatureFlagPayload] = useState<JsonType>()
    // would be nice to have a default value above however it's not possible due
    // to a hydration error when using nextjs

    useEffect(() => {
        if (!client) {
            return
        }
        return client.onFeatureFlags(() => {
            setFeatureFlagPayload(client.getFeatureFlagPayload(flag))
        })
    }, [client, flag])

    return featureFlagPayload
}
