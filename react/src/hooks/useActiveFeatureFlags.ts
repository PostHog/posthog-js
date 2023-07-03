import { useState } from 'react'
import { usePostHog } from './usePostHog'
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect'

export function useActiveFeatureFlags(): string[] | undefined {
    const client = usePostHog()

    const [featureFlags, setFeatureFlags] = useState<string[] | undefined>()
    // would be nice to have a default value above however it's not possible due
    // to a hydration error when using nextjs

    useIsomorphicLayoutEffect(() => {
        return client.onFeatureFlags((flags) => {
            setFeatureFlags(flags)
        })
    }, [client])

    return featureFlags
}
