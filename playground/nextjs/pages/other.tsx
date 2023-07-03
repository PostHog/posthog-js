import Head from 'next/head'
import Link from 'next/link'
import { usePostHog } from 'posthog-js/react'

export default function Home() {
    const posthog = usePostHog()

    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main>
                <h1>Other page!</h1>

                <Link href="/">Go back</Link>
            </main>
        </>
    )
}
