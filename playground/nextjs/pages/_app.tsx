import '@/styles/globals.css'

import React, { useEffect } from 'react'
import type { AppProps } from 'next/app'
import { useRouter } from 'next/router'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { CookieBanner, cookieConsentGiven } from '@/src/CookieBanner'

if (typeof window !== 'undefined') {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
        session_recording: {
            recordCrossOriginIframes: true,
        },
        debug: true,
        __preview_send_client_session_params: true,
        scroll_root_selector: ['#scroll_element', 'html'],
        persistence: cookieConsentGiven() ? 'localStorage+cookie' : 'memory',
    })

    window.posthog = posthog
}

export default function App({ Component, pageProps }: AppProps) {
    const router = useRouter()

    useEffect(() => {
        // Track page views
        const handleRouteChange = () => posthog.capture('$pageview')
        router.events.on('routeChangeComplete', handleRouteChange)

        return () => {
            router.events.off('routeChangeComplete', handleRouteChange)
        }
    }, [])

    return (
        <PostHogProvider client={posthog}>
            <Component {...pageProps} />

            <CookieBanner />
        </PostHogProvider>
    )
}
