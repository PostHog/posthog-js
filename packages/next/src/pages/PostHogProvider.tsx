import React from 'react'
import type { PostHogConfig, BootstrapConfig } from 'posthog-js'
import { ClientPostHogProvider } from '../client/ClientPostHogProvider.js'
import { NEXTJS_CLIENT_DEFAULTS, resolveApiKey, resolveHostOrDefault } from '../shared/config.js'
import { identityToBootstrap, type PostHogProviderIdentity } from '../shared/identity.js'

export interface PagesPostHogProviderProps {
    /**
     * PostHog project API key (starts with phc_).
     * If omitted, reads from `NEXT_PUBLIC_POSTHOG_KEY` env var.
     */
    apiKey?: string
    /** Optional posthog-js configuration overrides. */
    clientOptions?: Partial<PostHogConfig>
    /** Server-known identity to bootstrap the client SDK with. */
    identity?: PostHogProviderIdentity
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
let apiKeyWarned = false

export function PostHogProvider({
    apiKey: apiKeyProp,
    clientOptions,
    identity,
    bootstrap,
    children,
}: PagesPostHogProviderProps) {
    const apiKey = resolveApiKey(apiKeyProp)
    if (!apiKey) {
        return <>{children}</>
    }

    if (!apiKeyWarned && !apiKey.startsWith('phc_')) {
        apiKeyWarned = true
        // eslint-disable-next-line no-console
        console.warn(
            `[PostHog Next.js] apiKey "${apiKey}" does not start with "phc_". This may not be a valid PostHog project API key.`
        )
    }

    const host = resolveHostOrDefault(clientOptions?.api_host)
    const resolvedOptions: Partial<PostHogConfig> = {
        ...NEXTJS_CLIENT_DEFAULTS,
        ...clientOptions,
        ...(host ? { api_host: host } : {}),
    }

    const identityBootstrap = identityToBootstrap(identity)
    const resolvedBootstrap = identityBootstrap ? { ...(bootstrap ?? {}), ...identityBootstrap } : bootstrap

    return (
        <ClientPostHogProvider apiKey={apiKey} options={resolvedOptions} bootstrap={resolvedBootstrap}>
            {children}
        </ClientPostHogProvider>
    )
}
