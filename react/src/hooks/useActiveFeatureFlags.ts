import { useEffect, useState } from 'react'
import { usePostHog } from './usePostHog'

export function useActiveFeatureFlags(): string[] | undefined {
    const client = usePostHog()

    const [featureFlags, setFeatureFlags] = useState<string[] | undefined>(() => client.featureFlags.getFlags())

    useEffect(() => {
        return client.onFeatureFlags((flags) => {
            setFeatureFlags(flags)
        })
    }, [client])

    return featureFlags
}
