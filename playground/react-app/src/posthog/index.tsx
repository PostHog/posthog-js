import * as React from 'react'
import { useEffect, useState } from 'react'

import posthog from 'posthog-js'

type PostHog = typeof posthog

const PostHogContext = React.createContext<{ client?: PostHog }>({ client: undefined })

export function PostHogProvider({ children, client }: { children: React.ReactNode; client: PostHog }) {
    return <PostHogContext.Provider value={{ client }}>{children}</PostHogContext.Provider>
}

export const usePostHog = (): PostHog | undefined => {
    const { client } = React.useContext(PostHogContext)
    return client
}

export function useFeatureFlag(flag: string): string | boolean | undefined {
    const client = usePostHog()

    const [featureFlag, setFeatureFlag] = useState<boolean | string | undefined>(client?.getFeatureFlag(flag))

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
