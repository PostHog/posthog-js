/* eslint-disable posthog-js/no-direct-null-check */
import { ReactElement, useEffect, useState } from 'react'
import { ConsentState, cookieConsentGiven, posthog, updatePostHogConsent } from './posthog'

export function useCookieConsent(): [ConsentState, (consentGiven: 'granted' | 'denied' | 'pending') => void] {
    const [consentGiven, setConsentGiven] = useState<ConsentState>(undefined)

    useEffect(() => {
        setConsentGiven(cookieConsentGiven())
    }, [])

    useEffect(() => {
        if (consentGiven === undefined || posthog.config.cookieless_mode === 'always') {
            return
        }

        updatePostHogConsent(consentGiven)
    }, [consentGiven])

    return [consentGiven, setConsentGiven]
}

export function CookieBanner(): ReactElement | null {
    const [consentGiven, setConsentGiven] = useCookieConsent()

    // eslint-disable-next-line posthog-js/no-direct-undefined-check
    if (consentGiven === undefined || posthog.config.cookieless_mode === 'always') {
        return null
    }

    return (
        <div className="fixed right-2 bottom-2 border rounded p-2 bg-gray-100 text-sm space-y-2">
            {consentGiven === 'pending' ? (
                <>
                    <p>I am a cookie banner - you wouldn't like me when I'm hangry.</p>
                    <div className="space-x-2">
                        <button
                            onClick={() => {
                                setConsentGiven('granted')
                            }}
                        >
                            Approved!
                        </button>
                        <button
                            onClick={() => {
                                setConsentGiven('denied')
                            }}
                        >
                            Denied!
                        </button>
                    </div>
                </>
            ) : consentGiven === 'granted' ? (
                <>
                    <button
                        onClick={() => {
                            setConsentGiven('denied')
                        }}
                    >
                        Give back my cookies! (revoke consent)
                    </button>
                    <button
                        onClick={() => {
                            setConsentGiven('pending')
                        }}
                    >
                        Reset
                    </button>
                </>
            ) : (
                <>
                    <button
                        onClick={() => {
                            setConsentGiven('granted')
                        }}
                    >
                        Ok you can have a cookie (accept cookies)
                    </button>
                    <button
                        onClick={() => {
                            setConsentGiven('pending')
                        }}
                    >
                        Reset
                    </button>
                </>
            )}
        </div>
    )
}
