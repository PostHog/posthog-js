/* eslint-disable no-console */
import posthogJs, { PostHogConfig } from 'posthog-js'

import React, { useMemo } from 'react'
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
    options?: Partial<PostHogConfig> | undefined
}) {
    const posthog = useMemo(() => {
        if (client && apiKey) {
            console.warn(
                '[PostHog.js] You have provided both a client and an apiKey to PostHogProvider. The apiKey will be ignored in favour of the client.'
            )
        }

        if (client && options) {
            console.warn(
                '[PostHog.js] You have provided both a client and options to PostHogProvider. The options will be ignored in favour of the client.'
            )
        }

        if (client) {
            return client
        }

        if (apiKey) {
            if (posthogJs.__loaded) {
                console.warn('[PostHog.js] was already loaded elsewhere. This may cause issues.')
            }
            posthogJs.init(apiKey, options)
        }

        return posthogJs
    }, [client, apiKey])

    return <PostHogContext.Provider value={{ client: posthog }}>{children}</PostHogContext.Provider>
}
