import React from 'react'
import type { AppProps } from 'next/app'
import { PostHogProvider } from 'posthog-js/react'
import type { PostHogConfig } from 'posthog-js'
import { NEXTJS_CLIENT_DEFAULTS } from '../shared/config'

/**
 * Configuration for the withPostHogApp HOC.
 */
export interface WithPostHogAppOptions {
    /** PostHog project API key */
    apiKey: string
    /** Optional posthog-js configuration overrides */
    options?: Partial<PostHogConfig>
}

type NextApp = React.ComponentType<AppProps>

/**
 * Higher-order component that wraps a Next.js Page Router `_app` with PostHog.
 *
 * @example
 * ```tsx
 * // pages/_app.tsx
 * import type { AppProps } from 'next/app'
 * import { withPostHogApp } from '@posthog/next/pages'
 *
 * function MyApp({ Component, pageProps }: AppProps) {
 *   return <Component {...pageProps} />
 * }
 *
 * export default withPostHogApp(MyApp, {
 *   apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY!,
 *   options: { api_host: 'https://us.i.posthog.com' },
 * })
 * ```
 */
export function withPostHogApp(App: NextApp, config: WithPostHogAppOptions): NextApp {
    const mergedOptions: Partial<PostHogConfig> = { ...NEXTJS_CLIENT_DEFAULTS, ...config.options }

    function PostHogApp(props: AppProps) {
        return (
            <PostHogProvider apiKey={config.apiKey} options={mergedOptions}>
                <App {...props} />
            </PostHogProvider>
        )
    }

    PostHogApp.displayName = `withPostHogApp(${App.displayName || App.name || 'App'})`

    return PostHogApp
}
