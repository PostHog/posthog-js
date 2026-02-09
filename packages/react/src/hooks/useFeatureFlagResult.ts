import { FeatureFlagResult } from 'posthog-js'
import { useContext, useEffect, useState } from 'react'
import { PostHogContext } from '../context'
import { isUndefined } from '../utils/type-utils'

export function useFeatureFlagResult(flag: string): FeatureFlagResult | undefined {
    const { client, bootstrap } = useContext(PostHogContext)

    const [result, setResult] = useState<FeatureFlagResult | undefined>(() => client.getFeatureFlagResult(flag))

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setResult(client.getFeatureFlagResult(flag))
        })
    }, [client, flag])

    if (!client?.featureFlags?.hasLoadedFlags && bootstrap?.featureFlags) {
        const bootstrappedValue = bootstrap.featureFlags[flag]
        if (isUndefined(bootstrappedValue)) {
            return undefined
        }
        return {
            key: flag,
            enabled: typeof bootstrappedValue === 'string' ? true : !!bootstrappedValue,
            variant: typeof bootstrappedValue === 'string' ? bootstrappedValue : undefined,
            payload: bootstrap.featureFlagPayloads?.[flag],
        }
    }

    return result
}
