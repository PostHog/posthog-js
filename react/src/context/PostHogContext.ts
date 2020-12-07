import React from 'react'
import { PostHog } from 'posthog-js'

export interface PostHogContextValue {
    client?: PostHog
}

// Track the PostHog context in global state to ensure that all consumers of the context
// are accessing the same instance of the PostHog client
const cache = new Map<typeof React.createContext, React.Context<PostHogContextValue>>()

export function usePostHogContext(): React.Context<PostHogContextValue> {
    let context: React.Context<PostHogContextValue> | undefined = cache.get(React.createContext)
    if (!context) {
        context = React.createContext<PostHogContextValue>({})
        cache.set(React.createContext, context)
    }
    return context
}
