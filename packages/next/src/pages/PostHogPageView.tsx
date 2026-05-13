import { useEffect } from 'react'
import { useRouter } from 'next/router.js'
import { usePostHog } from '@posthog/react'
import { getCurrentUrl } from '../shared/browser.js'

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
        const currentUrl = getCurrentUrl()
        if (!posthog || !router.isReady || !currentUrl) {
            return
        }

        posthog.capture('$pageview', { $current_url: currentUrl })
    }, [router.asPath, router.isReady, posthog])

    return null
}
