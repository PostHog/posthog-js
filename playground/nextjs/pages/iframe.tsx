import Head from 'next/head'
import { usePostHog } from 'posthog-js/react'
import { useEffect, useState } from 'react'

export default function Home() {
    const posthog = usePostHog()

    const [otherHost, setOtherHost] = useState('')

    useEffect(() => {
        setOtherHost(window.location.origin.includes('other-localhost') ? 'localhost' : 'other-localhost')
    })

    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
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
                            posthog?.capture('iframe loaded')
                        }}
                    />
                )}
            </main>
        </>
    )
}
