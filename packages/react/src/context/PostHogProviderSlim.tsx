import React, { useMemo } from 'react'
import type { PostHog } from 'posthog-js'
import { PostHogContext } from './PostHogContext'

/**
 * Slim PostHogProvider for use with @posthog/react/slim.
 *
 * Only accepts a pre-initialized `client` instance. Does not support
 * `apiKey`/`options` props since the slim bundle has no posthog-js runtime.
 */
export function PostHogProvider({
    client,
    children,
}: {
    client: PostHog
    children?: React.ReactNode
}) {
    const value = useMemo(() => ({ client, bootstrap: client.config?.bootstrap }), [client])
    return (
        <PostHogContext.Provider value={value}>
            {children}
        </PostHogContext.Provider>
    )
}
