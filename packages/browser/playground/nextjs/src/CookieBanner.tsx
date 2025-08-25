/* eslint-disable posthog-js/no-direct-null-check */
import { useEffect, useState, ReactElement } from 'react'
import { ConsentState, cookieConsentGiven, posthog, updatePostHogConsent } from './posthog'

export function useCookieConsent(): [ConsentState | null, (consentGiven: ConsentState) => void] {
    const [consentGiven, setConsentGiven] = useState<ConsentState | null>(null)

    useEffect(() => {
        setConsentGiven(cookieConsentGiven())
    }, [])

    useEffect(() => {
        if (consentGiven == null || posthog.config.cookieless_mode === 'always') {
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
            {consentGiven === null ? (
                <>
                    <p>I am a cookie banner - you wouldn't like me when I'm hangry.</p>
                    <div className="space-x-2">
                        <button
                            onClick={() => {
                                setConsentGiven(true)
                            }}
                        >
                            Approved!
                        </button>
                        <button
                            onClick={() => {
                                setConsentGiven(false)
                            }}
                        >
                            Denied!
                        </button>
                    </div>
                </>
            ) : consentGiven ? (
                <>
                    <button
                        onClick={() => {
                            setConsentGiven(false)
                        }}
                    >
                        Give back my cookies! (revoke consent)
                    </button>
                    <button
                        onClick={() => {
                            posthog.reset()
                        }}
                    >
                        Reset
                    </button>
                </>
            ) : (
                <>
                    <button
                        onClick={() => {
                            setConsentGiven(true)
                        }}
                    >
                        Ok you can have a cookie (accept cookies)
                    </button>
                    <button
                        onClick={() => {
                            posthog.clear_opt_in_out_capturing()
                            posthog.reset()
                            setConsentGiven(null)
                        }}
                    >
                        Reset
                    </button>
                </>
            )}
        </div>
    )
}
