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
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>

            <main>
                <PageHeader />
                <Component {...pageProps} />
                <CookieBanner />
            </main>
        </PostHogProvider>
    )
}
