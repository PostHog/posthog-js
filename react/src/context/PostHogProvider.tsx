import posthogJs from 'posthog-js'

import * as React from 'react'

import { useEffect, useState } from 'react'
import { PostHog, PostHogContext } from './PostHogContext'

export function PostHogProvider({
    children,
    client,
    apiKey,
    options,
}: {
    children?: React.ReactNode
    client?: PostHog | undefined
    apiKey?: string | undefined
    options?: any | undefined
}) {
    const [posthog, setPosthog] = useState<PostHog | undefined>(client)

    useEffect(() => {
        if (client && apiKey) {
            console.warn(
                'You have provided both a client and an apiKey to PostHogProvider. The apiKey will be ignored in favour of the client.'
            )
        }

        if (client && options) {
            console.warn(
                'You have provided both a client and options to PostHogProvider. The options will be ignored in favour of the client.'
            )
        }

        if (client) {
            setPosthog(client)
        } else if (apiKey) {
            posthogJs.init(apiKey, options)
            setPosthog(posthogJs)
        }
    }, [client, apiKey, options])

    return <PostHogContext.Provider value={{ client: posthog }}>{children}</PostHogContext.Provider>
}
