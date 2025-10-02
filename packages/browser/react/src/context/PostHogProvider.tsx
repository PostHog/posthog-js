/* eslint-disable no-console */
import posthogJs, { PostHogConfig } from 'posthog-js'

import React, { useEffect, useMemo, useRef } from 'react'
import { PostHog, PostHogContext } from './PostHogContext'
import { isDeepEqual } from '../utils/object-utils'

interface PreviousInitialization {
    apiKey: string
    options: Partial<PostHogConfig>
}

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
 *
 * We strongly suggest you memoize the `options` object to ensure that you don't
 * accidentally trigger unnecessary re-renders. We'll properly detect if the options
 * have changed and only call `posthogJs.set_config` if they have, but it's better to
 * avoid unnecessary re-renders in the first place.
 */
export function PostHogProvider({ children, client, apiKey, options }: WithOptionalChildren<PostHogProviderProps>) {
    // Used to detect if the client was already initialized
    // This is used to prevent double initialization when running under React.StrictMode
    // We're not storing a simple boolean here because we want to be able to detect if the
    // apiKey or options have changed.
    const previousInitializationRef = useRef<PreviousInitialization | null>(null)

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
            return client
        }

        if (apiKey) {
            // return the global client, we'll initialize it in the useEffect
            return posthogJs
        }

        console.warn(
            '[PostHog.js] No `apiKey` or `client` were provided to `PostHogProvider`. Using default global `window.posthog` instance. You must initialize it manually. This is not recommended behavior.'
        )
        return posthogJs
    }, [client, apiKey, JSON.stringify(options)]) // Stringify options to be a stable reference

    // TRICKY: The init needs to happen in a useEffect rather than useMemo, as useEffect does not happen during SSR. Otherwise
    // we'd end up trying to call posthogJs.init() on the server, which can cause issues around hydration and double-init.
    useEffect(() => {
        if (client) {
            // if the user has passed their own client, assume they will also handle calling init().
            return
        }
        const previousInitialization = previousInitializationRef.current

        if (!previousInitialization) {
            // If it's the first time running this, but it has been loaded elsewhere, warn the user about it.
            if (posthogJs.__loaded) {
                console.warn('[PostHog.js] `posthog` was already loaded elsewhere. This may cause issues.')
            }

            // Init global client
            posthogJs.init(apiKey, options)

            // Keep track of whether the client was already initialized
            // This is used to prevent double initialization when running under React.StrictMode, and to know when options change
            previousInitializationRef.current = {
                apiKey: apiKey,
                options: options ?? {},
            }
        } else {
            // If the client was already initialized, we might still end up running the effect again for a few reasons:
            // * someone is developing locally under `React.StrictMode`
            // * the config has changed
            // * the apiKey has changed (not supported!)
            //
            // Changing the apiKey isn't well supported and we'll simply log a message suggesting them
            // to take control of the `client` initialization themselves. This is tricky to handle
            // ourselves because we wouldn't know if we should call `.reset()` or not, for example.
            if (apiKey !== previousInitialization.apiKey) {
                console.warn(
                    "[PostHog.js] You have provided a different `apiKey` to `PostHogProvider` than the one that was already initialized. This is not supported by our provider and we'll keep using the previous key. If you need to toggle between API Keys you need to control the `client` yourself and pass it in as a prop rather than an `apiKey` prop."
                )
            }

            // Changing options is better supported because we can just call `posthogJs.set_config(options)`
            // and they'll be good to go with their new config. The SDK will know how to handle the changes.
            if (options && !isDeepEqual(options, previousInitialization.options)) {
                posthogJs.set_config(options)
            }

            // Keep track of the possibly-new set of apiKey and options
            previousInitializationRef.current = {
                apiKey: apiKey,
                options: options ?? {},
            }
        }
    }, [client, apiKey, JSON.stringify(options)]) // Stringify options to be a stable reference

    return <PostHogContext.Provider value={{ client: posthog }}>{children}</PostHogContext.Provider>
}
