import Head from 'next/head'
import styles from '@/styles/Home.module.css'
import { useEffect, useState } from 'react'
import { posthog } from '@/utils/posthog'
import { useFeatureFlags } from '@/utils/posthog-react'

export default function Home() {
    const featureFlags = useFeatureFlags()

    useEffect(() => {
        posthog?.capture('$pageview')
    }, [])

    const clicked = () => {
        if (posthog) {
            posthog.capture('button clicked')
            console.log('sent event to posthog')
        }
    }

    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main className={styles.main}>
                <div className={styles.description}>
                    <p>PostHog</p>
                    <p>Feature flag response: {JSON.stringify(featureFlags)}</p>
                    <button onClick={clicked}>Click me</button>
                </div>
            </main>
        </>
    )
}
