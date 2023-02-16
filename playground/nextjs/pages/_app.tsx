import '@/styles/globals.css'
import { PostHogProvider } from '@/utils/posthog-react'
import type { AppProps } from 'next/app'

import { useRouter } from 'next/router'
import posthog from 'posthog-js'
import { useEffect } from 'react'

export default function App({ Component, pageProps }: AppProps) {
    const router = useRouter()

    if (typeof window !== 'undefined') {
        // This ensures that as long as we are client-side, posthog is always ready
        posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
            api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'http://localhost:8000',
        })
    }

    // useEffect(() => {
    //     // Track page views
    //     const handleRouteChange = () => posthog?.capture('$pageview')
    //     router.events.on('routeChangeComplete', handleRouteChange)

    //     return () => {
    //         router.events.off('routeChangeComplete', handleRouteChange)
    //     }
    // }, [])

    return (
        <PostHogProvider client={posthog}>
            <Component {...pageProps} />
        </PostHogProvider>
    )
}
