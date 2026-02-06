'use client'
import { usePostHog } from 'posthog-js/react'
import { captureServerError } from './actions'

function randomID() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

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
                        Capture error manually
                    </button>
                    <button
                        onClick={() => {
                            throw new Error('exception captured')
                        }}
                    >
                        Capture error automatically
                    </button>
                    <button
                        onClick={() => {
                            Promise.reject(new Error('promise rejection captured'))
                        }}
                    >
                        Capture promise rejection automatically
                    </button>
                    <button onClick={() => captureServerError()}>Create server exception!</button>
                    <button
                        onClick={() =>
                            posthog.captureException(new Error('custom fingerprint'), {
                                $exception_fingerprint: randomID(),
                            })
                        }
                    >
                        Create custom fingerprint!
                    </button>
                    <button onClick={() => console.error('This is an error message')}>Error log something</button>
                </div>
            </main>
        </div>
    )
}
