'use client'

import Link from 'next/link'
import posthog from 'posthog-js'

export default function Home() {
    return (
        <div>
            <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <Link href="./error?messsage=Rendering%20Error">
                    <button>Generate rendering error</button>
                </Link>
                <button onClick={() => posthog.captureException(new Error('Programming error'))}>Send error</button>
            </main>
        </div>
    )
}
