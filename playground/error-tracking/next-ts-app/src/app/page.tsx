'use client'

import posthog from 'posthog-js'

function sendException() {
    posthog.captureException(new Error('New Error'))
}

export default function Home() {
    return (
        <div>
            <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <button onClick={() => sendException()}>Send exception</button>
            </main>
        </div>
    )
}
