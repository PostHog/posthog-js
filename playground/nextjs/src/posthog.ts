import posthog, { PostHogConfig } from 'posthog-js'

/**
 * Below is an example of a consent-driven config for PostHog
 * Lots of things start in a disabled state and posthog will not use cookies without consent
 *
 * Once given, we enable autocapture, session recording, and use localStorage+cookie for persistence via set_config
 * This is only an example - data privacy requirements are different for every project
 */
export function cookieConsentGiven(): null | boolean {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('cookie_consent') === 'true'
}

export const configForConsent = (): Partial<PostHogConfig> => {
    const consentGiven = localStorage.getItem('cookie_consent') === 'true'

    return {
        persistence: consentGiven ? 'localStorage+cookie' : 'memory',
        disable_surveys: !consentGiven,
        autocapture: consentGiven,
        disable_session_recording: !consentGiven,
    }
}

export const updatePostHogConsent = (consentGiven: boolean) => {
    if (consentGiven) {
        localStorage.setItem('cookie_consent', 'true')
    } else {
        localStorage.removeItem('cookie_consent')
    }

    posthog.set_config(configForConsent())
}

if (typeof window !== 'undefined') {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        session_recording: {
            recordCrossOriginIframes: true,
        },
        debug: true,
        scroll_root_selector: ['#scroll_element', 'html'],
        // persistence: cookieConsentGiven() ? 'localStorage+cookie' : 'memory',
        person_profiles: 'identified_only',
        __preview_heatmaps: true,
        ...configForConsent(),
    })
    ;(window as any).posthog = posthog
}
