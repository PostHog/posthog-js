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
                        Create client exception!
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
                    <button
                        onClick={() =>
                            console.warn(
                                'a really long string that exceeds the maximum length of a log message and is longer than the maximum length of a log message and is longer than the maximum length of a log message'
                            )
                        }
                    >
                        Log something large
                    </button>
                </div>
            </main>
        </div>
    )
}
