import { useActiveFeatureFlags, usePostHog } from 'posthog-js/react'
import React, { useEffect, useState } from 'react'
import { PERSON_PROCESSING_MODE, cookieConsentGiven } from '@/src/posthog'

export default function Home() {
    const posthog = usePostHog()
    const [isClient, setIsClient] = useState(false)
    const flags = useActiveFeatureFlags()

    const [time, setTime] = useState('')
    const consentGiven = cookieConsentGiven()

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
            <p className="italic my-2 text-gray-500">The current time is {time}</p>

            <h2>Trigger posthog events</h2>
            <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => posthog.capture('Clicked button')}>Capture event</button>
                <button onClick={() => posthog.capture('user_subscribed')}>Subscribe to newsletter</button>
                <button onClick={() => posthog.capture('user_unsubscribed')}>Unsubscribe from newsletter</button>
                <button data-attr="autocapture-button">Autocapture buttons</button>
                <a className="Button" data-attr="autocapture-button" href="#">
                    <span>Autocapture a &gt; span</span>
                </a>

                <button className="ph-no-capture">Ignore certain elements</button>

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

            {isClient && (
                <>
                    {!consentGiven && (
                        <p className="border border-red-900 bg-red-200 rounded p-2">
                            <b>Consent not given!</b> Session recording, surveys, and autocapture are disabled.
                        </p>
                    )}

                    <h2 className="mt-4">PostHog info</h2>
                    <ul className="text-xs bg-gray-100 rounded border-2 border-gray-800 p-4 space-y-2">
                        <li className="font-mono">
                            Person Mode: <b>{PERSON_PROCESSING_MODE}</b>
                        </li>
                        <li className="font-mono">
                            DistinctID: <b>{posthog.get_distinct_id()}</b>
                        </li>
                        <li className="font-mono">
                            SessionID: <b>{posthog.get_session_id()}</b>
                        </li>

                        <li className="font-mono">
                            Active flags:
                            <pre className="text-xs">
                                <code>{JSON.stringify(flags, null, 2)}</code>
                            </pre>
                        </li>
                    </ul>

                    <h2 className="mt-4">PostHog config</h2>
                    <pre className="text-xs bg-gray-100 rounded border-2 border-gray-800 p-4">
                        <code>{JSON.stringify(posthog.config, null, 2)}</code>
                    </pre>
                </>
            )}
        </>
    )
}
