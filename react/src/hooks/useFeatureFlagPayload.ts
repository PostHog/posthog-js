import { useEffect, useState } from 'react'
import { JsonType } from 'posthog-js'
import { usePostHog } from './usePostHog'

export function useFeatureFlagPayload(
    flag: string,
    options?: { groups?: Record<string, string> }
): JsonType {
    const client = usePostHog()

    const [featureFlagPayload, setFeatureFlagPayload] = useState<JsonType>(() => client.getFeatureFlagPayload(flag))

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureFlagPayload(client.getFeatureFlagPayload(flag))
        })
    }, [client, flag, options])

    return featureFlagPayload
}
