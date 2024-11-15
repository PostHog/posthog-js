import '@/styles/globals.css'

import { useEffect } from 'react'
import type { AppProps } from 'next/app'
import { useRouter } from 'next/router'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { CookieBanner } from '@/src/CookieBanner'
import '@/src/posthog'
import Head from 'next/head'
import { PageHeader } from '@/src/Header'
import { useUser } from '@/src/auth'
import { posthogHelpers } from '@/src/posthog'

export default function App({ Component, pageProps }: AppProps) {
    const router = useRouter()

    const user = useUser()

    useEffect(() => {
        if (user) {
            posthogHelpers.setUser(user)
        }
    }, [user])

    useEffect(() => {
        // Track page views
        const handleRouteChange = () => posthog.capture('$pageview')
        router.events.on('routeChangeComplete', handleRouteChange)

        return () => {
            router.events.off('routeChangeComplete', handleRouteChange)
        }
    }, [])

    const localhostDomain = process.env.NEXT_PUBLIC_CROSSDOMAIN ? 'https://localhost:8000' : 'http://localhost:8000'

    return (
        <PostHogProvider client={posthog}>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                {/* CSP - useful for testing our documented recommendations. NOTE: Unsafe is only needed for nextjs pre-loading */}
                <meta
                    http-equiv="Content-Security-Policy"
                    content={`
                    default-src 'self';
                    connect-src 'self' ${localhostDomain} https://*.posthog.com;
                    script-src 'self' 'unsafe-eval' 'unsafe-inline' ${localhostDomain} https://*.posthog.com;
                    style-src 'self' 'unsafe-inline' ${localhostDomain} https://*.posthog.com;
                    img-src 'self' ${localhostDomain} https://*.posthog.com;
                `}
                />
            </Head>

            <main>
                <PageHeader />
                <Component {...pageProps} />
                <CookieBanner />
            </main>
        </PostHogProvider>
    )
}
