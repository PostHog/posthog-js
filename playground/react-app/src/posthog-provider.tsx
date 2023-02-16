import * as React from 'react'

import posthog from 'posthog-js'

import { useContext, useEffect, useState } from 'react'

type PostHog = typeof posthog

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
export function usePostHogContext() {
    const context = useContext(getPostHogContext())
    if (!context.client) {
        throw new Error(
            'No PostHog client instance can be found. ' +
                'Please ensure that your application is wrapped by `PostHogProvider`.'
        )
    }
    return context
}

export function usePostHog() {
    const context = usePostHogContext()
    return context.client
}

/**
 * The PostHog provider
 * @property client - The initialised PostHog client
 * @property children - React node(s) to be wrapped by the PostHog provider
 * @returns React Provider node which enables child react node(s) to consume the PostHog context
 */
export function PostHogProvider({ client, children }: { client: PostHog; children: React.ReactNode }) {
    const PostHogContext = getPostHogContext()
    const [featureFlags, setFeatureFlags] = useState({ enabled: {} })

    return (
        <PostHogContext.Consumer>
            {(context) => {
                if (client && context.client !== client) {
                    context = Object.assign({}, context, { client })
                }

                if (!context.client) {
                    throw new Error(
                        'PostHogProvider was not passed a client instance. ' +
                            'Make sure you pass in your PostHog client via the "client" prop.'
                    )
                }

                const value = { ...context, featureFlags, setFeatureFlags }
                return <PostHogContext.Provider value={value}>{children}</PostHogContext.Provider>
            }}
        </PostHogContext.Consumer>
    )
}

// const PostHogContext = React.createContext<{ client?: PostHog }>({ client: undefined })

// export function PostHogProvider({ children, client }: { children: React.ReactNode; client: PostHog }) {
//     return <PostHogContext.Provider value={{ client }}>{children}</PostHogContext.Provider>
// }

// export function useFeatureFlag(flag: string): string | boolean | undefined {
//     const posthog = usePostHog()

//     const [featureFlag, setFeatureFlag] = useState<boolean | string | undefined>(posthog?.getFeatureFlag(flag))

//     useEffect(() => {
//         if (!posthog) {
//             return
//         }
//         setFeatureFlag(posthog.getFeatureFlag(flag))
//         return posthog.onFeatureFlags(() => {
//             setFeatureFlag(posthog.getFeatureFlag(flag))
//         })
//     }, [posthog, flag])

//     return featureFlag
// }
