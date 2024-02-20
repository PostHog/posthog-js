/* eslint-disable posthog-js/no-direct-null-check */
import posthog from 'posthog-js'
import { useEffect, useState } from 'react'

export function cookieConsentGiven() {
    return localStorage.getItem('cookie_consent') === 'true'
}

export function CookieBanner() {
    const [consentGiven, setConsentGiven] = useState<null | boolean>(null)

    useEffect(() => {
        setConsentGiven(cookieConsentGiven())
    }, [])

    useEffect(() => {
        if (consentGiven === null) return
        posthog.set_config({ persistence: consentGiven ? 'localStorage+cookie' : 'memory' })
    }, [consentGiven])

    if (consentGiven === null) return null

    return (
        <div className="fixed right-2 bottom-2 border rounded p-2 bg-gray-100 text-sm">
            {!consentGiven ? (
                <>
                    <p>I am a cookie banner - you wouldn't like me when I'm hangry.</p>
                    <button
                        onClick={() => {
                            localStorage.setItem('cookie_consent', 'true')
                            setConsentGiven(true)
                        }}
                    >
                        Approved!
                    </button>
                </>
            ) : (
                <>
                    <button
                        onClick={() => {
                            localStorage.removeItem('cookie_consent')
                            setConsentGiven(false)
                        }}
                    >
                        Give back my cookies!
                    </button>
                </>
            )}
        </div>
    )
}
