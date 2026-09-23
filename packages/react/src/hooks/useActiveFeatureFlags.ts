import { useContext, useEffect, useState } from 'react'
import { PostHogContext } from '../context'
import { normalizeBootstrappedFlagValue } from '../utils/feature-flag-utils'

export function useActiveFeatureFlags(): string[] {
    const { client, bootstrap } = useContext(PostHogContext)

    const [featureFlags, setFeatureFlags] = useState<string[]>(() => client.featureFlags.getFlags())

    useEffect(() => {
        return client.onFeatureFlags((flags) => {
            setFeatureFlags(flags)
        })
    }, [client])

    // if the client is not loaded yet and we have a bootstrapped value, use it
    if (!client?.featureFlags?.hasLoadedFlags && bootstrap?.featureFlags) {
        return Object.entries(bootstrap.featureFlags)
            .filter(([key, value]) => normalizeBootstrappedFlagValue(key, value))
            .map(([key]) => key)
    }

    return featureFlags
}
