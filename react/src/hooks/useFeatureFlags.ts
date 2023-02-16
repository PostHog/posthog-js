import { useEffect, useState } from 'react'
import { usePostHog } from './usePostHog'

export function useFeatureFlag(flag: string): string | boolean | undefined {
    const client = usePostHog()

    const [featureFlag, setFeatureFlag] = useState<boolean | string | undefined>()
    // would be nice to have a default value above however it's not possible due
    // to a hydration error when using nextjs

    useEffect(() => {
        if (!client) {
            return
        }
        setFeatureFlag(client.getFeatureFlag(flag))
        return client.onFeatureFlags(() => {
            setFeatureFlag(client.getFeatureFlag(flag))
        })
    }, [client, flag])

    return featureFlag
}
