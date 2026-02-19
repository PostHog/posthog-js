'use client'

import React from 'react'
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
 */
export function ClientPostHogProvider({ apiKey, options, bootstrap, children }: ClientPostHogProviderProps) {
    if (!apiKey) {
        throw new Error('[PostHog Next.js] apiKey is required')
    }

    const mergedOptions = bootstrap
        ? { ...options, bootstrap: { ...options?.bootstrap, ...bootstrap } }
        : options

    return (
        <ReactPostHogProvider apiKey={apiKey} options={mergedOptions}>
            {children}
        </ReactPostHogProvider>
    )
}
