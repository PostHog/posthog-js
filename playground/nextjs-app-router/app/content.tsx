'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useFeatureFlagEnabled, usePostHog } from 'posthog-js/react'

export default function Content({ flags }: { flags: Record<string, string | boolean> }) {
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
            <main>
                <h1>PostHog React</h1>

                <p>The current time is {time}</p>

                <div className="buttons">
                    <button onClick={() => posthog.capture('Clicked button')}>Capture event</button>
                    <button data-attr="autocapture-button">Autocapture buttons</button>
                    <a data-attr="autocapture-button" href="#">
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
                </div>

                <div className="buttons">
                    <Link href="/animations">Animations</Link>
                    <Link href="/iframe">Iframe</Link>
                    <Link href="/media">Media</Link>
                    <Link href="/long">Long</Link>
                </div>

                <p>
                    Feature flag response: <code>{JSON.stringify(result)}</code>
                </p>
                <p>
                    SSR feature flags: <code>{JSON.stringify(flags)}</code>
                </p>
            </main>
        </>
    )
}
