import * as React from 'react'
import { useEffect, useState } from 'react'

import posthogJs from 'posthog-js'

type PostHog = typeof posthogJs

const PostHogContext = React.createContext<{ client?: PostHog }>({ client: undefined })

export function PostHogProvider({
    children,
    client,
    apiKey,
    options,
}: {
    children?: React.ReactNode
    client?: PostHog | undefined
    apiKey?: string | undefined
    options?: any | undefined
}) {
    const [posthog, setPosthog] = useState<PostHog | undefined>()

    useEffect(() => {
        if (client && apiKey) {
            console.warn(
                'You have provided both a client and an apiKey to PostHogProvider. The apiKey will be ignored in favour of the client.'
            )
        }

        if (client) {
            setPosthog(client)
        } else if (apiKey) {
            posthogJs.init(apiKey, options)
            setPosthog(posthogJs)
        }
    }, [client, apiKey, options])

    return <PostHogContext.Provider value={{ client: posthog }}>{children}</PostHogContext.Provider>
}

export const usePostHog = (): PostHog | undefined => {
    const { client } = React.useContext(PostHogContext)
    return client
}

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
