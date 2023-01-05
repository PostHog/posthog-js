import React, { useState, Dispatch, SetStateAction } from 'react'
import { PostHog } from 'posthog-js'
import { getPostHogContext } from './PostHogContext'

/**
 * An object containing details about PostHog feature flags
 * @property active - List of active feature flags
 * @property enabled - An object containing feature flags with the value of their enabled status
 */
export interface FeatureFlags {
    active?: string[]
    enabled: FeatureFlags
}

/**
 * The parameters for the PostHog provider
 * @property client - The initialised PostHog client
 * @property children - React node(s) to be wrapped by the PostHog provider
 */
interface PostHogProviderProps {
    client: PostHog
    children: React.ReactNode | React.ReactNode[] | null
}

/**
 * The PostHog context object value
 * @property client - The initialised PostHog client
 * @property featureFlags - An object containing details about PostHog feature flags
 * @property setFeatureFlags - State dispatcher function for updating the stored featureFlags object
 */
export interface PostHogProviderValue {
    client?: PostHog
    featureFlags: FeatureFlags
    setFeatureFlags: Dispatch<SetStateAction<FeatureFlags>>
}

/**
 * The PostHog provider
 * @property client - The initialised PostHog client
 * @property children - React node(s) to be wrapped by the PostHog provider
 * @returns React Provider node which enables child react node(s) to consume the PostHog context
 */
export const PostHogProvider: React.FC<PostHogProviderProps> = ({ client, children }: PostHogProviderProps) => {
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

                const value: PostHogProviderValue = { ...context, featureFlags, setFeatureFlags }
                return <PostHogContext.Provider value={value}>{children}</PostHogContext.Provider>
            }}
        </PostHogContext.Consumer>
    )
}
