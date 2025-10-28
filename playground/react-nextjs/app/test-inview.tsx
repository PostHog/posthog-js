'use client'

import { PostHogInView } from '@posthog/react'

export function TestInView() {
    return (
        <div style={{ marginTop: '100vh', padding: '2rem', backgroundColor: '#ffeaa7' }}>
            <h2>Scroll down to see this test component</h2>
            <PostHogInView
                name="test-element"
                properties={{ test: true }}
                observerOptions={{ threshold: 0.1 }}
                style={{ padding: '2rem', backgroundColor: '#00b894', color: 'white' }}
            >
                <p>This is a test element with a low threshold (0.1 = 10%)</p>
                <p>It should trigger as soon as 10% of it is visible</p>
            </PostHogInView>
        </div>
    )
}
