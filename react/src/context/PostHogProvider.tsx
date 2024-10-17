/* eslint-disable no-console */
import posthogJs, { PostHogConfig } from 'posthog-js'

import React, { useEffect, useState } from 'react'
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
    const [posthog, setPosthog] = useState<PostHog | null>(null)
    useEffect(() => {
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
            setPosthog(client)
        }

        if (apiKey) {
            if (posthogJs.__loaded) {
                console.warn('[PostHog.js] was already loaded elsewhere. This may cause issues.')
            }
            posthogJs.init(apiKey, options)
            setPosthog(posthogJs)
        }

        console.warn('[PostHog.js] you must provide a client or apikey')
    }, [client, apiKey])

    return posthog ? (
        <PostHogContext.Provider value={{ client: posthog }}>{children}</PostHogContext.Provider>
    ) : (
        <>children</>
    )
}
