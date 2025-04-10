'use client'

import Link from 'next/link'
import posthog from 'posthog-js'

export default function Home() {
    return (
        <div>
            <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <Link href="./error?throw">Go to error</Link>
                <button onClick={() => posthog.captureException(new Error('Programming error'))}>
                    Capture Exception
                </button>
            </main>
        </div>
    )
}
