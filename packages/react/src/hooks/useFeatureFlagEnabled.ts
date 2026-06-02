import { useContext, useEffect, useState } from 'react'
import { PostHogContext } from '../context'
import { isUndefined } from '../utils/type-utils'

export function useFeatureFlagEnabled(flag: string): boolean | undefined
export function useFeatureFlagEnabled(flag: string, defaultValue: boolean): boolean
export function useFeatureFlagEnabled(flag: string, defaultValue?: boolean): boolean | undefined {
    const { client, bootstrap } = useContext(PostHogContext)

    const [featureEnabled, setFeatureEnabled] = useState<boolean | undefined>(() => client.isFeatureEnabled(flag))

    useEffect(() => {
        return client.onFeatureFlags(() => {
            setFeatureEnabled(client.isFeatureEnabled(flag))
        })
    }, [client, flag])

    const bootstrapped = bootstrap?.featureFlags?.[flag]

    // if the client is not loaded yet, check if we have a bootstrapped value and then true/false it
    if (!client?.featureFlags?.hasLoadedFlags && bootstrap?.featureFlags) {
        return isUndefined(bootstrapped) ? defaultValue : !!bootstrapped
    }

    // while the flag value is unknown (flags not loaded, or the flag is absent), fall back to defaultValue
    return isUndefined(featureEnabled) ? defaultValue : featureEnabled
}
