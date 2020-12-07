import React from 'react'
import { PostHog } from 'posthog-js'
import { usePostHogContext, PostHogContextValue } from './PostHogContext'

export interface PostHogProviderProps {
    client: PostHog
    children: React.ReactNode | React.ReactNode[] | null
}

export const PostHogProvider: React.FC<PostHogProviderProps> = ({ client, children }) => {
    const PostHogContext = usePostHogContext()
    return (
        <PostHogContext.Consumer>
            {(context: PostHogContextValue) => {
                if (client && context.client !== client) {
                    context = Object.assign({}, context, { client })
                }
                return <PostHogContext.Provider value={context}>{children}</PostHogContext.Provider>
            }}
        </PostHogContext.Consumer>
    )
}
