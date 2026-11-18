import React from 'react'
import Link from '@docusaurus/Link'

export default function Home() {
    return (
        <main>
            <h1>PostHog compatibility sample</h1>
            <Link to="/second">Second page</Link>
            <button onClick={() => window.posthog?.capture('sample_button_clicked')}>Capture event</button>
        </main>
    )
}
