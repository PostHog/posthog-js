'use client'

import { Suspense, useEffect } from 'react'
import { useParams, usePathname, useSearchParams } from 'next/navigation.js'
import { usePostHog } from '@posthog/react'
import { isArray } from '@posthog/core'
import { getCurrentUrl } from '../shared/browser.js'

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
export interface PostHogPageViewProps {
    /**
     * Set `$pathname` to a best-effort Next.js route template, such as `/posts/[id]`.
     * The concrete URL remains available in `$current_url`.
     *
     * App Router templates are inferred from `useParams()`. Ambiguous matches fall back to the concrete pathname,
     * and optional catch-all parameters use the normalized `[...param]` form when populated.
     *
     * @default false
     */
    captureRouteTemplate?: boolean
}

export function PostHogPageView({ captureRouteTemplate = false }: PostHogPageViewProps = {}) {
    return (
        <Suspense fallback={null}>
            {captureRouteTemplate ? <RouteTemplatePageViewTracker /> : <PageViewTracker />}
        </Suspense>
    )
}

type RouteParams = Record<string, string | string[] | undefined>

function decodedSegmentMatches(segment: string, value: string): boolean {
    if (segment === value) {
        return true
    }

    try {
        return decodeURIComponent(segment) === value
    } catch {
        return false
    }
}

function findMatchingIndexes(segments: string[], values: string[]): number[] {
    const matches: number[] = []

    for (let index = 0; index + values.length <= segments.length; index++) {
        if (values.every((value, offset) => decodedSegmentMatches(segments[index + offset], value))) {
            matches.push(index)
        }
    }

    return matches
}

function computeRouteTemplate(pathname: string, params: RouteParams): string | undefined {
    const segments = pathname.split('/')

    for (const [paramName, paramValue] of Object.entries(params)) {
        if (!isArray(paramValue) || paramValue.length === 0) {
            continue
        }

        const matches = findMatchingIndexes(segments, paramValue)
        if (matches.length !== 1) {
            return undefined
        }
        segments.splice(matches[0], paramValue.length, `[...${paramName}]`)
    }

    for (const [paramName, paramValue] of Object.entries(params)) {
        if (typeof paramValue !== 'string' || !paramValue) {
            continue
        }

        const matches = findMatchingIndexes(segments, [paramValue])
        if (matches.length !== 1) {
            return undefined
        }
        segments[matches[0]] = `[${paramName}]`
    }

    return segments.join('/')
}

function RouteTemplatePageViewTracker() {
    const params = useParams<RouteParams>()
    return <PageViewTracker params={params} />
}

interface PageViewTrackerProps {
    params?: RouteParams
}

function PageViewTracker({ params }: PageViewTrackerProps = {}) {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const posthog = usePostHog()
    const routeTemplate = params ? computeRouteTemplate(pathname, params) : undefined

    useEffect(() => {
        const search = searchParams.toString()
        const currentUrl = getCurrentUrl(search ? `${pathname}?${search}` : pathname)
        if (!posthog || !currentUrl) {
            return
        }

        posthog.capture('$pageview', {
            $current_url: currentUrl,
            ...(routeTemplate ? { $pathname: routeTemplate } : {}),
        })
    }, [pathname, searchParams, posthog, routeTemplate])

    return null
}
