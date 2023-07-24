import Head from 'next/head'
import { useFeatureFlagEnabled, usePostHog } from 'posthog-js/react'
import { useEffect, useState } from 'react'
import { Player, Controls } from '@lottiefiles/react-lottie-player'
import Link from 'next/link'

export default function Home() {
    const posthog = usePostHog()
    const result = useFeatureFlagEnabled('test')

    const [time, setTime] = useState('')

    useEffect(() => {
        const t = setInterval(() => {
            setTime(new Date().toISOString().split('T')[1].split('.')[0])
        }, 1000)

        return () => {
            clearInterval(t)
        }
    }, [])

    const randomID = () => Math.round(Math.random() * 10000)

    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main>
                <h1>PostHog React</h1>

                <p>The current time is {time}</p>

                <div className="buttons">
                    <button onClick={() => posthog.capture('Clicked button')}>Capture event</button>
                    <button data-attr="autocapture-button">Autocapture buttons</button>
                    <button className="ph-no-capture">Ignore certain elements</button>

                    <button onClick={() => posthog?.identify('user-' + randomID())}>Identify</button>

                    <button
                        onClick={() =>
                            posthog?.setPersonProperties({
                                email: `user-${randomID()}@posthog.com`,
                            })
                        }
                    >
                        Set user properties
                    </button>
                </div>

                <div className="buttons">
                    <Link href="/animations">Animations</Link>
                    <Link href="/iframe">Iframe</Link>
                </div>

                <p>Feature flag response: {JSON.stringify(result)}</p>
            </main>
        </>
    )
}
