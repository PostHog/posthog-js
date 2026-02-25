import React from 'react'
import type { PostHogConfig, BootstrapConfig } from 'posthog-js'
import { ClientPostHogProvider } from '../client/ClientPostHogProvider'
import { NEXTJS_CLIENT_DEFAULTS, resolveApiKey } from '../shared/config'

export interface PagesPostHogProviderProps {
    /**
     * PostHog project API key (starts with phc_).
     * If omitted, reads from `NEXT_PUBLIC_POSTHOG_KEY` env var.
     */
    apiKey?: string
    /** Optional posthog-js configuration overrides. */
    options?: Partial<PostHogConfig>
    /** Server-evaluated bootstrap data from getServerSidePostHog. */
    bootstrap?: BootstrapConfig
    children: React.ReactNode
}

/**
 * PostHog provider for Next.js Pages Router.
 *
 * Place this in your `pages/_app.tsx` wrapping `<Component {...pageProps} />`.
 *
 * @example
 * ```tsx
 * import { PostHogProvider } from '@posthog/next/pages'
 *
 * export default function App({ Component, pageProps }: AppProps) {
 *   return (
 *     <PostHogProvider apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY!}>
 *       <Component {...pageProps} />
 *     </PostHogProvider>
 *   )
 * }
 * ```
 */
export function PostHogProvider({ apiKey: apiKeyProp, options, bootstrap, children }: PagesPostHogProviderProps) {
    const apiKey = resolveApiKey(apiKeyProp)
    if (!apiKey.startsWith('phc_')) {
        console.warn(`[PostHog Next.js] apiKey "${apiKey}" does not start with "phc_". This may not be a valid PostHog project API key.`)
    }

    const host = options?.api_host ?? process.env.NEXT_PUBLIC_POSTHOG_HOST
    const resolvedOptions: Partial<PostHogConfig> = {
        ...NEXTJS_CLIENT_DEFAULTS,
        ...options,
        ...(host ? { api_host: host } : {}),
    }

    return (
        <ClientPostHogProvider apiKey={apiKey} options={resolvedOptions} bootstrap={bootstrap}>
            {children}
        </ClientPostHogProvider>
    )
}
