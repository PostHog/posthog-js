'use client'
import { useEffect } from 'react'
import { usePostHog } from 'posthog-js/react'
import { captureServerError } from './actions'

function randomID() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

export default function Home() {
    const posthog = usePostHog()

    useEffect(() => {
        posthog.addExceptionStep('Viewed checkout page', {
            flow: 'checkout',
            step: 'pageview',
            pathname: window.location.pathname,
        })
    }, [posthog])

    const addCheckoutExceptionSteps = () => {
        posthog.addExceptionStep('Opened checkout modal', {
            flow: 'checkout',
            step: 'open-modal',
        })
        posthog.addExceptionStep('Entered payment details', {
            flow: 'checkout',
            step: 'enter-payment-details',
            provider: 'stripe',
        })
        posthog.addExceptionStep('Clicked "Pay now"', {
            flow: 'checkout',
            step: 'pay-now',
        })
    }

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
                    <button
                        onClick={() => {
                            addCheckoutExceptionSteps()
                            posthog.captureException(new Error('Payment authorization failed'))
                        }}
                    >
                        Capture error manually
                    </button>
                    <button
                        onClick={() => {
                            addCheckoutExceptionSteps()
                            throw new Error('Payment form crashed before submit')
                        }}
                    >
                        Capture error automatically
                    </button>
                    <button
                        onClick={() => {
                            addCheckoutExceptionSteps()
                            Promise.reject(new Error('Payment provider timed out'))
                        }}
                    >
                        Capture promise rejection automatically
                    </button>
                    <button onClick={() => posthog.capture('$exception')}>Capture exception via capture()</button>
                    <button
                        onClick={() => {
                            posthog.addExceptionStep('Submitted checkout to server')
                            captureServerError()
                        }}
                    >
                        Create server exception!
                    </button>
                    <button
                        onClick={() => {
                            addCheckoutExceptionSteps()
                            posthog.captureException(new Error('custom fingerprint'), {
                                $exception_fingerprint: randomID(),
                            })
                        }}
                    >
                        Create custom fingerprint!
                    </button>
                    <button onClick={() => console.error('This is an error message')}>Error log something</button>
                </div>
            </main>
        </div>
    )
}
