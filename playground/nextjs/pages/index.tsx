import Head from 'next/head'
import { useFeatureFlag, usePostHog } from 'posthog-js/react'

export default function Home() {
    const posthog = usePostHog()
    const result = useFeatureFlag('test')
    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main>
                <p>PostHog React</p>
                <button onClick={() => posthog?.capture('Clicked button')}>This is a button</button>
                <p>Feature flag response: {JSON.stringify(result)}</p>
            </main>
        </>
    )
}
