'use client'
import { usePostHog } from 'posthog-js/react'
import { captureServerError } from './actions'

export default function Home() {
    const posthog = usePostHog()
    return (
        <div>
            <main>
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '30px',
                    }}
                >
                    <button onClick={() => posthog.captureException(new Error('exception captured'))}>
                        Create client exception!
                    </button>
                    <button onClick={() => captureServerError()}>Create server exception!</button>
                </div>
            </main>
        </div>
    )
}
