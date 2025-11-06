import { useContext, useEffect, useState } from 'react'
import { PostHogContext } from '../context'

export function useFeatureFlagVariantKey(flag: string): string | boolean | undefined {
    const { client, bootstrap } = useContext(PostHogContext)

    const [featureFlagVariantKey, setFeatureFlagVariantKey] = useState<string | boolean | undefined>(() =>
        client.getFeatureFlag(flag)
    )

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureFlagVariantKey(client.getFeatureFlag(flag))
        })
    }, [client, flag])

    if (!client.featureFlags.hasLoadedFlags && bootstrap?.featureFlags) {
        return bootstrap.featureFlags[flag]
    }

    return featureFlagVariantKey
}
