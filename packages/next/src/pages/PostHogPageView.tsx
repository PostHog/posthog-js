import { useEffect } from 'react'
import { useRouter } from 'next/router.js'
import { usePostHog } from '@posthog/react'
import { stripUrlHash } from '@posthog/core'
import { getCurrentUrl } from '../shared/browser.js'

/**
 * Tracks pageviews on route change in Next.js Pages Router.
 *
 * Place this component inside your `PostHogProvider` in `pages/_app.tsx`.
 * It will automatically capture a `$pageview` event whenever the route changes.
 *
 * Uses `router.asPath` which includes query parameters and may include hash fragments.
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
        const currentUrl = getCurrentUrl(router.asPath)
        const currentUrlWithoutHash =
            posthog?.config?.disable_capture_url_hashes !== false && currentUrl ? stripUrlHash(currentUrl) : currentUrl
        if (!posthog || !router.isReady || !currentUrlWithoutHash) {
            return
        }

        posthog.capture('$pageview', { $current_url: currentUrlWithoutHash })
    }, [router.asPath, router.isReady, posthog])

    return null
}
