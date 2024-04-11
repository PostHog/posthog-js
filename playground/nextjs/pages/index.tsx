import Head from 'next/head'
import { useFeatureFlagEnabled, usePostHog } from 'posthog-js/react'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'

export default function Home() {
    const posthog = usePostHog()
    const [isClient, setIsClient] = useState(false)
    const result = useFeatureFlagEnabled('test')

    const [time, setTime] = useState('')

    useEffect(() => {
        setIsClient(true)
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
                <div className="sticky top-0 bg-white border-b mb-4">
                    <h1 className="m-0">
                        <b>PostHog</b> React
                    </h1>
                </div>

                <p>The current time is {time}</p>

                <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => posthog.capture('Clicked button')}>Capture event</button>
                    <button data-attr="autocapture-button">Autocapture buttons</button>
                    <a className="Button" data-attr="autocapture-button" href="#">
                        <span>Autocapture a &gt; span</span>
                    </a>

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

                    <button onClick={() => posthog?.reset()}>Reset</button>
                </div>

                <div className="flex items-center gap-2">
                    <Link href="/animations">Animations</Link>
                    <Link href="/iframe">Iframe</Link>
                    <Link href="/canvas">Canvas</Link>
                    <Link href="/media">Media</Link>
                    <Link href="/long">Long</Link>
                    <Link href="/longmain">Long Main</Link>
                </div>

                <p>Feature flag response: {JSON.stringify(result)}</p>

                {isClient && (
                    <>
                        <h2 className="mt-4">PostHog info</h2>
                        <ul className="text-xs bg-gray-100 rounded border-2 border-gray-800 p-4">
                            <li className="font-mono">
                                DistinctID: <b>{posthog.get_distinct_id()}</b>
                            </li>
                            <li className="font-mono">
                                SessionID: <b>{posthog.get_session_id()}</b>
                            </li>
                            <code></code>
                        </ul>

                        <h2 className="mt-4">PostHog config</h2>
                        <pre className="text-xs bg-gray-100 rounded border-2 border-gray-800 p-4">
                            <code>{JSON.stringify(posthog.config, null, 2)}</code>
                        </pre>
                    </>
                )}
            </main>
        </>
    )
}
