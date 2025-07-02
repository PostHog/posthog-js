/* eslint-disable posthog-js/no-direct-null-check */
import { useEffect, useState } from 'react'
import { cookieConsentGiven, posthog, updatePostHogConsent } from './posthog'

export function useCookieConsent(): [boolean | null, (consentGiven: boolean) => void] {
    // this will be null during SSR and will be set to true/false on the client
    const [consentGiven, setConsentGiven] = useState<boolean | null>(null)
    useEffect(() => {
        const storedConsent = cookieConsentGiven()
        console.log({ storedConsent, consent: posthog.consent })
        setConsentGiven(storedConsent)
    }, [])

    const onConsentGiven = (consent: boolean) => {
        if (consent !== consentGiven) {
            updatePostHogConsent(consent)
        }
        setConsentGiven(consent)
    }

    return [consentGiven, onConsentGiven]
}

export function CookieBanner() {
    const [consentGiven, setConsentGiven] = useCookieConsent()

    if (consentGiven === null) return null

    return (
        <div className="fixed right-2 bottom-2 border rounded p-2 bg-gray-100 text-sm">
            {!consentGiven ? (
                <>
                    <p>I am a cookie banner - you wouldn't like me when I'm hangry.</p>
                    <button
                        onClick={() => {
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
