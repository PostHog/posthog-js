import type { JsonType } from 'posthog-js'
import { useContext, useEffect, useState } from 'react'
import { PostHogContext } from '../context'

export function useFeatureFlagPayload(flag: string): JsonType {
    const { client, bootstrap } = useContext(PostHogContext)

    const [featureFlagPayload, setFeatureFlagPayload] = useState<JsonType>(
        () => client.getFeatureFlagResult(flag, { send_event: false })?.payload
    )

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureFlagPayload(client.getFeatureFlagResult(flag, { send_event: false })?.payload)
        })
    }, [client, flag])

    // if the client is not loaded yet, use the bootstrapped value
    if (!client?.featureFlags?.hasLoadedFlags && bootstrap?.featureFlagPayloads) {
        return bootstrap.featureFlagPayloads[flag]
    }

    return featureFlagPayload
}
