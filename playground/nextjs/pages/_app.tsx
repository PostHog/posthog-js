import '@/styles/globals.css'

import React, { useEffect } from 'react'
import type { AppProps } from 'next/app'
import { useRouter } from 'next/router'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'

if (typeof window !== 'undefined') {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
        session_recording: {
            recordCrossOriginIframes: true,
        },
        debug: true,
        __preview_send_client_session_params: true,
        scroll_root_selector: ['#scroll_element', 'html'],
    })
    ;(window as any).posthog = posthog
}

function CookieBanner() {
    const [show, setShow] = React.useState(false)

    useEffect(() => {
        if (localStorage.getItem('cookie_consent') !== 'true') {
            setShow(true)
        }
    }, [])

    return (
        <div className="absolute left-2 bottom-2 border rounded p-2">
            {show ? (
                <>
                    <p>I am a cookie banner - hear me roar.</p>
                    <button
                        onClick={() => {
                            localStorage.setItem('cookie_consent', 'true')
                            setShow(false)
                        }}
                    >
                        Approved!
                    </button>
                </>
            ) : (
                <>
                    <button
                        onClick={() => {
                            localStorage.removeItem('cookie_consent')
                            setShow(true)
                        }}
                    >
                        No cookies!
                    </button>
                </>
            )}
        </div>
    )
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
