import * as React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'

import posthog from 'posthog-js'

type PostHog = typeof posthog

const PostHogContext = createContext<{ client?: PostHog }>({ client: undefined })

export function PostHogProvider({ children, client }: { children: React.ReactNode; client: PostHog }) {
    if (!client) {
        throw new Error('PostHogProvider requires a client')
    }
    return <PostHogContext.Provider value={{ client }}>{children}</PostHogContext.Provider>
}

export const usePostHog = (): PostHog | undefined => {
    const { client } = useContext(PostHogContext)

    return client
}

export function useFeatureFlag(flag: string): string | boolean | undefined {
    const client = usePostHog()

    const [featureFlag, setFeatureFlag] = useState<boolean | string | undefined>() 
    // would be nice to have a default value above however it's not possible due to a hydration error
    // this hydration error

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
