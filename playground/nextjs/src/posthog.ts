import posthog, { PostHogConfig } from 'posthog-js'
import { User } from './auth'

const PERSON_PROCESSING_MODE: 'always' | 'identified_only' | 'never' =
    (process.env.NEXT_PUBLIC_POSTHOG_PERSON_PROCESSING_MODE as any) || 'identified_only'

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
        persistence: cookieConsentGiven() ? 'localStorage+cookie' : 'memory',
        person_profiles: PERSON_PROCESSING_MODE === 'never' ? 'identified_only' : PERSON_PROCESSING_MODE,
        __preview_heatmaps: true,
        persistence_name: `${process.env.NEXT_PUBLIC_POSTHOG_KEY}_nextjs`,
        ...configForConsent(),
    })

    // Help with debugging(window as any).posthog = posthog
}

export const posthogHelpers = {
    onLogin: (user: User) => {
        if (PERSON_PROCESSING_MODE === 'never') {
            // We just set the user properties instead of identifying them
            posthogHelpers.setUser(user)
        } else {
            posthog.identify(user.email, user)
        }

        posthog.capture('Logged in')
    },
    onLogout: () => {
        posthog.capture('Logged out')
        posthog.reset()
    },
    setUser: (user: User) => {
        if (PERSON_PROCESSING_MODE === 'never') {
            const eventProperties = {
                person_id: user.email,
                person_email: user.email,
                person_name: user.name,
                team_id: user.team?.id,
                team_name: user.team?.name,
            }
            posthog.register(eventProperties)
            posthog.setPersonPropertiesForFlags(user)

        } else {
            // NOTE: Would this always get set?
            if (user.team) {
                posthog.group('team', user.team.id, user.team)
            }
        }
    },
}
