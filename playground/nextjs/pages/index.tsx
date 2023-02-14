import Head from 'next/head'
import styles from '@/styles/Home.module.css'
import { useEffect, useState } from 'react'
import { posthog } from '@/utils/posthog'

export default function Home() {
    const [flagValue, setFlagValue] = useState<any>()

    useEffect(() => {
        posthog?.onFeatureFlags(() => {
            setFlagValue(posthog?.getFeatureFlag('test'))
        })
    }, [])

    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main className={styles.main}>
                <div className={styles.description}>
                    <p>PostHog</p>
                    <p>Feature flag response: {JSON.stringify(flagValue)}</p>
                </div>
            </main>
        </>
    )
}
