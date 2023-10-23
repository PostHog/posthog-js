'use client'

import { usePostHog } from 'posthog-js/react'
import { useEffect, useState } from 'react'

export default function Page() {
    const posthog = usePostHog()

    const [otherHost, setOtherHost] = useState('')

    useEffect(() => {
        setOtherHost(window.location.origin.includes('other-localhost') ? 'localhost' : 'other-localhost')
    })

    return (
        <>
            <main>
                <h1>Iframes</h1>

                <h2>Cross origin iframe</h2>
                <p>
                    This loads the same page but from <b>other-localhost</b> which you need to add to your hosts file.
                </p>

                {otherHost && (
                    <iframe
                        src={`http://${otherHost}:3000/`}
                        style={{ width: '100%', height: '500px' }}
                        onLoad={() => {
                            posthog.capture('iframe loaded')
                        }}
                    />
                )}
            </main>
        </>
    )
}
