/* eslint-disable no-console */
import posthogJs, { PostHogConfig } from 'posthog-js'

import React, { useMemo } from 'react'
import { PostHog, PostHogContext } from './PostHogContext'

type WithOptionalChildren<T> = T & { children?: React.ReactNode | undefined }

/**
 * Props for the PostHogProvider component.
 * This is a discriminated union type that ensures mutually exclusive props:
 *
 * - If `client` is provided, `apiKey` and `options` must not be provided
 * - If `apiKey` is provided, `client` must not be provided, and `options` is optional
 */
type PostHogProviderProps =
    | { client: PostHog; apiKey?: never; options?: never }
    | { apiKey: string; options?: Partial<PostHogConfig>; client?: never }

/**
 * PostHogProvider is a React context provider for PostHog analytics.
 * It can be initialized in two mutually exclusive ways:
 *
 * 1. By providing an existing PostHog `client` instance
 * 2. By providing an `apiKey` (and optionally `options`) to create a new client
 *
 * These initialization methods are mutually exclusive - you must use one or the other,
 * but not both simultaneously.
 */
export function PostHogProvider({ children, client, apiKey, options }: WithOptionalChildren<PostHogProviderProps>) {
    const posthog = useMemo(() => {
        if (client) {
            if (apiKey) {
                console.warn(
                    '[PostHog.js] You have provided both `client` and `apiKey` to `PostHogProvider`. `apiKey` will be ignored in favour of `client`.'
                )
            }

            if (options) {
                console.warn(
                    '[PostHog.js] You have provided both `client` and `options` to `PostHogProvider`. `options` will be ignored in favour of `client`.'
                )
            }

            if (client.__loaded) {
                console.warn('[PostHog.js] `client` was already loaded elsewhere. This may cause issues.')
            }

            return client
        }

        if (apiKey) {
            if (posthogJs.__loaded) {
                console.warn('[PostHog.js] `posthog` was already loaded elsewhere. This may cause issues.')
            }

            posthogJs.init(apiKey, options)
            return posthogJs
        }

        console.warn(
            '[PostHog.js] No `apiKey` or `client` were provided to `PostHogProvider`. Using default global `window.posthog` instance. You must initialize it manually. This is not recommended behavior.'
        )
        return posthogJs
    }, [client, apiKey])

    return <PostHogContext.Provider value={{ client: posthog }}>{children}</PostHogContext.Provider>
}
