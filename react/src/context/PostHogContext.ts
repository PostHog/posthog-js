import React, { useContext } from 'react'
import { PostHogProviderValue } from './PostHogProvider'

// Track the PostHog context in global state to ensure that all consumers of the context
// are accessing the same context object
const cache = new Map<typeof React.createContext, React.Context<any>>()

/**
 * A helper function that stores the PostHog context in global state
 * @returns The React context that contains the PostHog context
 */
export function getPostHogContext(): React.Context<any> {
    let context: React.Context<any> | undefined = cache.get(React.createContext)
    if (!context) {
        context = React.createContext<any>({})
        cache.set(React.createContext, context)
    }
    return context
}

/**
 * An abstraction for consuming the PostHog context
 * @returns The PostHog context object
 */
export function usePostHogContext(): PostHogProviderValue {
    const context = useContext(getPostHogContext())
    return context
}
