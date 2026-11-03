import React from 'react'
import type { PostHogConfig } from 'posthog-js'
import { ClientPostHogProvider } from '../client/ClientPostHogProvider.js'
import {
    NEXTJS_CLIENT_DEFAULTS,
    getProjectTokenOption,
    resolveHostOrDefault,
    resolveProjectToken,
    type ProjectTokenOptions,
} from '../shared/config.js'

export interface PagesPostHogProviderProps extends ProjectTokenOptions {
    /** Optional posthog-js configuration overrides. */
    clientOptions?: Partial<PostHogConfig>
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
 *     <PostHogProvider projectToken={process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!}>
 *       <Component {...pageProps} />
 *     </PostHogProvider>
 *   )
 * }
 * ```
 */
let projectTokenWarned = false

export function PostHogProvider({ clientOptions, children, ...tokenOptions }: PagesPostHogProviderProps) {
    const projectToken = resolveProjectToken(getProjectTokenOption(tokenOptions))
    if (!projectToken) {
        return <>{children}</>
    }

    if (!projectTokenWarned && !projectToken.startsWith('phc_')) {
        projectTokenWarned = true
        // oxlint-disable-next-line no-console
        console.warn(
            `[PostHog Next.js] projectToken "${projectToken}" does not start with "phc_". This may not be a valid PostHog project token.`
        )
    }

    const host = resolveHostOrDefault(clientOptions?.api_host)
    const resolvedOptions: Partial<PostHogConfig> = {
        ...NEXTJS_CLIENT_DEFAULTS,
        ...clientOptions,
        ...(host ? { api_host: host } : {}),
    }

    return (
        <ClientPostHogProvider projectToken={projectToken} options={resolvedOptions}>
            {children}
        </ClientPostHogProvider>
    )
}
