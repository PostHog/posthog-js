// NOTE: This is how you can include the external dependencies so they are in your bundle and not loaded async at runtime
// import 'posthog-js/dist/recorder'
// import 'posthog-js/dist/surveys'
// import 'posthog-js/dist/exception-autocapture'
// import 'posthog-js/dist/tracing-headers'

import posthogJS, { PostHog, PostHogConfig } from 'posthog-js'
import { User } from './auth'

export const PERSON_PROCESSING_MODE: 'always' | 'identified_only' | 'never' =
    (process.env.NEXT_PUBLIC_POSTHOG_PERSON_PROCESSING_MODE as any) || 'identified_only'

export const POSTHOG_USE_SNIPPET: boolean = (process.env.NEXT_PUBLIC_POSTHOG_USE_SNIPPET as any) || false

export const posthog: PostHog = POSTHOG_USE_SNIPPET
    ? typeof window !== 'undefined'
        ? (window as any).posthog
        : null
    : posthogJS
/**
 * Below is an example of a consent-driven config for PostHog
 * Lots of things start in a disabled state and posthog will not use cookies without consent
 *
 * Once given, we enable autocapture, session recording, and use localStorage+cookie for persistence via set_config
 * This is only an example - data privacy requirements are different for every project
 */
export function cookieConsentGiven(): null | boolean {
    if (typeof window === 'undefined') return null
    return posthog.has_opted_in_capturing()
}

export const configForConsent = (): Partial<PostHogConfig> => {
    const consentGiven = posthog.has_opted_in_capturing()

    return {
        disable_surveys: !consentGiven,
        autocapture: consentGiven,
        disable_session_recording: !consentGiven,
    }
}

export const updatePostHogConsent = (consentGiven: boolean) => {
    if (consentGiven) {
        posthog.opt_in_capturing()
    } else {
        posthog.opt_out_capturing()
    }

    posthog.set_config(configForConsent())
}

if (typeof window !== 'undefined') {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        session_recording: {
            recordCrossOriginIframes: true,
            blockSelector: '.ph-block-image',
            ignoreClass: 'ph-ignore-image',
        },
        debug: true,
        capture_pageview: 'history_change',
        disable_web_experiments: false,
        scroll_root_selector: ['#scroll_element', 'html'],
        persistence: 'localStorage+cookie',
        person_profiles: PERSON_PROCESSING_MODE === 'never' ? 'identified_only' : PERSON_PROCESSING_MODE,
        persistence_name: `${process.env.NEXT_PUBLIC_POSTHOG_KEY}_nextjs`,
        opt_in_site_apps: true,
        integrations: {
            intercom: true,
            crispChat: true,
        },
        __preview_remote_config: true,
        cookieless_mode: 'on_reject',
        __preview_flags_v2: true,
        ...configForConsent(),
    })
    // Help with debugging
    ;(window as any).posthog = posthog
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
