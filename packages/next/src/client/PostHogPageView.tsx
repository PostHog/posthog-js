'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'

/**
 * Tracks pageviews on route change in Next.js App Router.
 *
 * Place this component inside your `PostHogProvider` (typically in `app/layout.tsx`).
 * It will automatically capture a `$pageview` event whenever the route changes.
 *
 * Includes its own Suspense boundary (required by `useSearchParams()`), so you
 * don't need to wrap it in one yourself.
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { PostHogProvider, PostHogPageView } from '@posthog/next'
 *
 * export default function RootLayout({ children }: { children: React.ReactNode }) {
 *   return (
 *     <html>
 *       <body>
 *         <PostHogProvider apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY!}>
 *           <PostHogPageView />
 *           {children}
 *         </PostHogProvider>
 *       </body>
 *     </html>
 *   )
 * }
 * ```
 */
export function PostHogPageView() {
    return (
        <Suspense fallback={null}>
            <PageViewTracker />
        </Suspense>
    )
}

function PageViewTracker() {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const posthog = usePostHog()

    useEffect(() => {
        if (!posthog) {
            return
        }

        let url = pathname
        const search = searchParams.toString()
        if (search) {
            url = `${pathname}?${search}`
        }

        posthog.capture('$pageview', { $current_url: url })
    }, [pathname, searchParams, posthog])

    return null
}
