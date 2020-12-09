import React, { useState, Dispatch, SetStateAction } from 'react'
import { PostHog } from 'posthog-js'
import { getPostHogContext } from './PostHogContext'

export interface PostHogProviderProps {
    client: PostHog
    children: React.ReactNode | React.ReactNode[] | null
}

export interface FeatureFlags {
    active?: string[]
    enabled: {
        [flag: string]: boolean
    }
}

export interface PostHogProviderValue {
    client?: PostHog
    featureFlags: FeatureFlags
    setFeatureFlags: Dispatch<SetStateAction<FeatureFlags>>
}

export const PostHogProvider: React.FC<PostHogProviderProps> = ({ client, children }: PostHogProviderProps) => {
    const PostHogContext = getPostHogContext()
    const [featureFlags, setFeatureFlags] = useState({ enabled: {} })

    return (
        <PostHogContext.Consumer>
            {(context) => {
                if (client && context.client !== client) {
                    context = Object.assign({}, context, { client })
                }
                const value: PostHogProviderValue = { ...context, featureFlags, setFeatureFlags }
                return <PostHogContext.Provider value={value}>{children}</PostHogContext.Provider>
            }}
        </PostHogContext.Consumer>
    )
}
