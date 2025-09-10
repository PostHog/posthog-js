import '@/styles/globals.css'

import type { AppProps } from 'next/app'
import { useEffect } from 'react'

import { CookieBanner } from '@/src/CookieBanner'
import { PageHeader } from '@/src/Header'
import { useUser } from '@/src/auth'
import { posthog, posthogHelpers } from '@/src/posthog'
import Head from 'next/head'
import { PostHogProvider } from 'posthog-js/react'

const CDP_DOMAINS = ['https://*.redditstatic.com', 'https://*.reddit.com'].join(' ')
const CHAT_DOMAINS = [
    'https://*.intercom.io',
    'https://*.intercomcdn.com',
    'wss://*.intercom.io',
    'https://static.intercomassets.com',
    'https://*.crisp.chat',
    'wss://*.relay.crisp.chat',
].join(' ')

export default function App({ Component, pageProps }: AppProps) {
    const user = useUser()
    useEffect(() => {
        // Use a type assertion to add the property to the window object
        ;(window as any).POSTHOG_DEBUG = true
        if (user) {
            posthogHelpers.setUser(user)
        }
    }, [user])

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
                    connect-src 'self' ${localhostDomain} https://*.posthog.com https://lottie.host ${CDP_DOMAINS} ${CHAT_DOMAINS};
                    script-src 'self' 'unsafe-eval' 'unsafe-inline' ${localhostDomain} https://*.posthog.com ${CDP_DOMAINS} ${CHAT_DOMAINS};
                    style-src 'self' 'unsafe-inline' ${localhostDomain} https://*.posthog.com ${CHAT_DOMAINS};
                    img-src 'self' data: blob: ${localhostDomain} https://*.posthog.com https://lottie.host https://cataas.com ${CDP_DOMAINS} ${CHAT_DOMAINS};
                    worker-src 'self' blob: ${CHAT_DOMAINS};
                    font-src 'self' ${localhostDomain} https://*.posthog.com ${CHAT_DOMAINS};
                    media-src 'self' ${localhostDomain} https://*.posthog.com ${CHAT_DOMAINS};
                    frame-src 'self' ${localhostDomain} https://*.posthog.com ${CHAT_DOMAINS};
                `}
                />
            </Head>

            <main className="max-w-full overflow-hidden">
                <PageHeader />
                <Component {...pageProps} />
                <CookieBanner />
            </main>
        </PostHogProvider>
    )
}
