import { useContext, useEffect, useState } from 'react'
import { PostHogContext } from '../context'
import { isUndefined } from '../utils/type-utils'

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

    if (isUndefined(featureFlagVariantKey)) {
        return bootstrap?.featureFlags?.[flag]
    }

    return featureFlagVariantKey
}
