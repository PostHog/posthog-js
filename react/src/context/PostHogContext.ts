import React, { useContext } from 'react'

// Track the PostHog context in global state to ensure that all consumers of the context
// are accessing the same context object
const cache = new Map<typeof React.createContext, React.Context<any>>()

export function getPostHogContext(): React.Context<any> {
    let context: React.Context<any> | undefined = cache.get(React.createContext)
    if (!context) {
        context = React.createContext<any>({})
        cache.set(React.createContext, context)
    }
    return context
}

export function usePostHogContext(): any {
    const context = useContext(getPostHogContext())
    return context
}
