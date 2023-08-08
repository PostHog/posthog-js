import Head from 'next/head'
import { useFeatureFlagEnabled, usePostHog } from 'posthog-js/react'
import { useEffect, useState } from 'react'
import { Player, Controls } from '@lottiefiles/react-lottie-player'

export default function Home() {
    const posthog = usePostHog()

    return (
        <>
            <Head>
                <title>PostHog</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <main>
                <h1>Animations</h1>
                <p>Useful testing for Replay handling heavy animations</p>
                <Player
                    src="https://lottie.host/7401522f-2d8b-4049-ad18-eb0edb6af224/CE9lFrNlEH.json"
                    // className="ph-no-capture"
                    background="Transparent"
                    speed={3}
                    style={{ width: 300, height: 300 }}
                    direction={1}
                    // mode="normal"
                    loop
                    // controls
                    autoplay
                />
                <Player
                    src="https://lottie.host/fb187981-8846-4ae9-98db-b95fc6347955/vO2S1YTZMn.json"
                    // className="ph-no-capture"
                    background="Transparent"
                    speed={3}
                    style={{ width: 300, height: 300 }}
                    direction={1}
                    // mode="normal"
                    loop
                    // controls
                    autoplay
                />
                <Player
                    src="https://lottie.host/3239c7de-e4de-4148-830d-e95b7f747f91/vftYOWDcUO.json"
                    // className="ph-no-capture"
                    background="Transparent"
                    speed={3}
                    style={{ width: 300, height: 300 }}
                    direction={1}
                    // mode="normal"
                    loop
                    // controls
                    autoplay
                />
            </main>
        </>
    )
}
