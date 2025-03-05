import '@/styles/globals.css'

import { useEffect } from 'react'
import type { AppProps } from 'next/app'
import { useRouter } from 'next/router'

import { PostHogProvider } from 'posthog-js/react'
import { CookieBanner } from '@/src/CookieBanner'
import { posthog } from '@/src/posthog'
import Head from 'next/head'
import { PageHeader } from '@/src/Header'
import { useUser } from '@/src/auth'
import { posthogHelpers } from '@/src/posthog'

const CDP_DOMAINS = ['https://*.redditstatic.com', 'https://*.reddit.com'].join(' ')

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

    useEffect(() => {
        // make sure we initialize the WebSocket server
        // we don't need to support IE11 here
        // eslint-disable-next-line compat/compat
        fetch('/api/socket')
    }, [])

    const localhostDomain = process.env.NEXT_PUBLIC_CROSSDOMAIN
        ? 'https://localhost:8000'
        : process.env.NEXT_PUBLIC_POSTHOG_HOST

    return (
        <PostHogProvider client={posthog}>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                {/* CSP - useful for testing our documented recommendations. NOTE: Unsafe is only needed for nextjs pre-loading */}
                <meta
                    httpEquiv="Content-Security-Policy"
                    content={`
                    default-src 'self';
                    connect-src 'self' ${localhostDomain} https://*.posthog.com https://lottie.host ${CDP_DOMAINS};
                    script-src 'self' 'unsafe-eval' 'unsafe-inline' ${localhostDomain} https://*.posthog.com ${CDP_DOMAINS};
                    style-src 'self' 'unsafe-inline' ${localhostDomain} https://*.posthog.com;
                    img-src 'self' ${localhostDomain} https://*.posthog.com https://lottie.host https://cataas.com ${CDP_DOMAINS};
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
