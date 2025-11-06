import { JsonType } from 'posthog-js'
import { useContext, useEffect, useState } from 'react'
import { PostHogContext } from '../context'
import { isUndefined } from '../utils/type-utils'

export function useFeatureFlagPayload(flag: string): JsonType {
    const { client, bootstrap } = useContext(PostHogContext)

    const [featureFlagPayload, setFeatureFlagPayload] = useState<JsonType>(() => client.getFeatureFlagPayload(flag))

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureFlagPayload(client.getFeatureFlagPayload(flag))
        })
    }, [client, flag])

    // if the client is not loaded yet, use the bootstrapped value
    if (isUndefined(featureFlagPayload)) {
        return bootstrap?.featureFlagPayloads?.[flag]
    }

    return featureFlagPayload
}
