import { navigator } from './globals'

// CAMPAIGN_PARAMS and EVENT_TO_PERSON_PROPERTIES should be kept in sync with
// https://github.com/PostHog/posthog/blob/master/plugin-server/src/utils/db/utils.ts#L60

// The list of campaign parameters that could be considered personal data under e.g. GDPR.
// These can be masked in URLs and properties before being sent to PostHog.
export const PERSONAL_DATA_CAMPAIGN_PARAMS = [
    'gclid', // google ads
    'gclsrc', // google ads 360
    'dclid', // google display ads
    'gbraid', // google ads, web to app
    'wbraid', // google ads, app to web
    'fbclid', // facebook
    'msclkid', // microsoft
    'twclid', // twitter
    'li_fat_id', // linkedin
    'igshid', // instagram
    'ttclid', // tiktok
    'rdt_cid', // reddit
    'epik', // pinterest
    'qclid', // quora
    'sccid', // snapchat
    'irclid', // impact
    '_kx', // klaviyo
]

export const MASKED = '<masked>'

export function getBrowserLanguage(): string | undefined {
    return (
        navigator?.language || (navigator as Record<string, any> | undefined)?.userLanguage // Any modern browser // IE11
    )
}

export function getBrowserLanguagePrefix(): string | undefined {
    const lang = getBrowserLanguage()
    return typeof lang === 'string' ? lang.split('-')[0] : undefined
}
