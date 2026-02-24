'use client'

import React from 'react'
import posthogJs from 'posthog-js'
import { PostHogProvider as ReactPostHogProvider } from 'posthog-js/react'
import type { BootstrapConfig, PostHogConfig } from 'posthog-js'

export type { BootstrapConfig }

export interface ClientPostHogProviderProps {
    /** PostHog project API key (starts with phc_) */
    apiKey: string
    /** Optional posthog-js configuration overrides */
    options?: Partial<PostHogConfig>
    /** Server-evaluated feature flag values to bootstrap the client SDK with */
    bootstrap?: BootstrapConfig
    children: React.ReactNode
}

/**
 * Client-side PostHog provider with SSR bootstrap support.
 *
 * This is an internal component rendered by PostHogProvider (server component).
 * It forwards bootstrap data to posthog-js so flag hooks return real values
 * immediately without a network round-trip.
 *
 * We initialize posthog-js eagerly during render (client-side only) rather than
 * deferring to a useEffect. React fires effects bottom-up, so child useEffects
 * (e.g. a consent banner) would access the posthog instance before the parent
 * provider's useEffect calls init(). By initializing during render and passing
 * the `client` prop, we guarantee the instance is fully configured before any
 * child code runs.
 */
export function ClientPostHogProvider({ apiKey, options, bootstrap, children }: ClientPostHogProviderProps) {
    if (!apiKey) {
        throw new Error('[PostHog Next.js] apiKey is required')
    }

    const mergedOptions = bootstrap
        ? { ...options, bootstrap: { ...options?.bootstrap, ...bootstrap } }
        : options

    // Initialize eagerly during render on the client so that child effects
    // see a fully configured posthog instance. The `__loaded` guard prevents
    // double-init (e.g. React StrictMode).
    if (typeof window !== 'undefined' && !posthogJs.__loaded) {
        posthogJs.init(apiKey, mergedOptions)
    }

    return (
        <ReactPostHogProvider client={posthogJs}>
            {children}
        </ReactPostHogProvider>
    )
}
