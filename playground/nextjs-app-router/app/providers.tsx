'use client'

import posthog from 'posthog-js'
import { useEffect } from 'react'
import { usePostHog } from 'posthog-js/react'
import { PostHogProvider } from 'posthog-js/react'
import { usePathname, useSearchParams } from 'next/navigation'

if (typeof window !== 'undefined') {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
        capture_pageview: false,
    })
}

export function PostHogPageview() {
    const pathname = usePathname()
    const searchParams = useSearchParams()

    useEffect(() => {
        if (pathname) {
            let url = (typeof window !== 'undefined' ? window.origin : '') + pathname
            if (searchParams && searchParams.toString()) {
                url = url + `?${searchParams.toString()}`
            }
            posthog.capture('$pageview', {
                $current_url: url,
            })
        }
    }, [pathname, searchParams])

    return <></>
}

export function PostHogCapture({ distinctId, children }: { distinctId: string; children: React.ReactNode }) {
    const posthog = usePostHog()

    useEffect(() => {
        posthog.identify(distinctId)
    }, [distinctId, posthog])

    return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
    return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
