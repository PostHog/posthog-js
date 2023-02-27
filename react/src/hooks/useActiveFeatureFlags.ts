import { useEffect, useState } from 'react'
import { usePostHog } from './usePostHog'

export function useActiveFeatureFlags(flag: string): string[] | undefined {
    const client = usePostHog()

    const [featureFlags, setFeatureFlags] = useState<string[] | undefined>()
    // would be nice to have a default value above however it's not possible due
    // to a hydration error when using nextjs

    useEffect(() => {
        if (!client) {
            return
        }
        return client.onFeatureFlags((flags) => {
            setFeatureFlags(flags)
        })
    }, [client, flag])

    return featureFlags
}
