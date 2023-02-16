import * as React from 'react'

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
