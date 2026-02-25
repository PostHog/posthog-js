import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { usePostHog } from 'posthog-js/react'

/**
 * Tracks pageviews on route change in Next.js Pages Router.
 *
 * Place this component inside your `PostHogProvider` in `pages/_app.tsx`.
 * It will automatically capture a `$pageview` event whenever the route changes.
 *
 * Uses `router.asPath` which includes query parameters and hash fragments.
 *
 * @example
 * ```tsx
 * // pages/_app.tsx
 * import { PostHogProvider, PostHogPageView } from '@posthog/next/pages'
 *
 * export default function App({ Component, pageProps }: AppProps) {
 *   return (
 *     <PostHogProvider apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY!}>
 *       <PostHogPageView />
 *       <Component {...pageProps} />
 *     </PostHogProvider>
 *   )
 * }
 * ```
 */
export function PostHogPageView() {
    const router = useRouter()
    const posthog = usePostHog()

    useEffect(() => {
        if (!posthog || !router.isReady) {
            return
        }

        posthog.capture('$pageview', { $current_url: router.asPath })
    }, [router.asPath, router.isReady, posthog])

    return null
}
