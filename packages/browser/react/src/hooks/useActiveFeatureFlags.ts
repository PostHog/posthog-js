import { useEffect, useState } from 'react'
import { usePostHog } from './usePostHog'

export function useActiveFeatureFlags(): string[] {
    const client = usePostHog()

    const [featureFlags, setFeatureFlags] = useState<string[]>(() => client.featureFlags.getFlags())

    useEffect(() => {
        return client.onFeatureFlags((flags) => {
            setFeatureFlags(flags)
        })
    }, [client])

    return featureFlags
}
