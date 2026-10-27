import { useEffect } from 'react'
import { useRouter } from 'next/router.js'
import { usePostHog } from '@posthog/react'
import { getRecordedUrl } from '@posthog/browser-common/utils/url-sanitization'
import { getCurrentUrl } from '../shared/browser.js'

export interface PostHogPageViewProps {
    /**
     * Capture the Next.js route template in `$route`, such as `/posts/[id]`.
     * The concrete URL remains available in `$current_url` and `$pathname`.
     * Optional catch-all parameters use the normalized `[...param]` form.
     *
     * @default false
     */
    captureRouteTemplate?: boolean
}

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
export function PostHogPageView({ captureRouteTemplate = false }: PostHogPageViewProps = {}) {
    const router = useRouter()
    const posthog = usePostHog()

    useEffect(() => {
        const currentUrl = getCurrentUrl(router.asPath)
        if (!posthog || !router.isReady || !currentUrl) {
            return
        }

        posthog.capture('$pageview', {
            $current_url: getRecordedUrl(currentUrl, posthog.config || {}),
            ...(captureRouteTemplate ? { $route: router.pathname.replace(/\[\[\.\.\.([^\]]+)\]\]/g, '[...$1]') } : {}),
        })
    }, [router.asPath, router.pathname, router.isReady, posthog, captureRouteTemplate])

    return null
}
