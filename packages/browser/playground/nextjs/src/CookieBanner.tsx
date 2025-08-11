/* eslint-disable posthog-js/no-direct-null-check */
import { useEffect, useState, ReactElement } from 'react'
import { cookieConsentGiven, posthog, updatePostHogConsent } from './posthog'

export function useCookieConsent(): [boolean | null, (consentGiven: boolean) => void] {
    const [consentGiven, setConsentGiven] = useState<boolean | null>(null)

    useEffect(() => {
        setConsentGiven(cookieConsentGiven())
    }, [])

    useEffect(() => {
        if (consentGiven === null || posthog.config.cookieless_mode === 'always') {
            return
        }

        updatePostHogConsent(consentGiven)
    }, [consentGiven])

    return [consentGiven, setConsentGiven]
}

export function CookieBanner(): ReactElement | null {
    const [consentGiven, setConsentGiven] = useCookieConsent()

    if (consentGiven === null || posthog.config.cookieless_mode === 'always') {
        return null
    }

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
