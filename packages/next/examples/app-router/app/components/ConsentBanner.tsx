'use client'

import { usePostHog } from '@posthog/next'
import { useEffect, useState } from 'react'

type ConsentState = 'pending' | 'granted' | 'denied'

export function ConsentBanner() {
    const posthog = usePostHog()
    const [consent, setConsent] = useState<ConsentState | null>(null)

    useEffect(() => {
        setConsent(posthog.get_explicit_consent_status())
    }, [posthog])

    const accept = () => {
        posthog.opt_in_capturing()
        setConsent('granted')
    }

    const decline = () => {
        posthog.opt_out_capturing()
        setConsent('denied')
    }

    const reset = () => {
        posthog.clear_opt_in_out_capturing()
        setConsent('pending')
    }

    if (consent === 'pending') {
        return (
            <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 shadow-lg p-4 z-50">
                <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
                    <p className="text-sm text-gray-700">
                        This site uses cookies for analytics. Do you consent to tracking?
                    </p>
                    <div className="flex gap-2 shrink-0">
                        <button
                            onClick={decline}
                            className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
                        >
                            Decline
                        </button>
                        <button
                            onClick={accept}
                            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                            Accept
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return ( consent &&
        <div className="fixed bottom-4 right-4 z-50">
            <button
                onClick={reset}
                className="px-3 py-1.5 text-xs bg-gray-100 border border-gray-300 rounded hover:bg-gray-200"
                title="Reset consent for testing"
            >
                Reset consent ({consent})
            </button>
        </div>
    )
}
