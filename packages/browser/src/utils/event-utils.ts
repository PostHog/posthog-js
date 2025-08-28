import { convertToURL, getQueryParam, maskQueryParams } from './request-utils'
import { isNull, stripLeadingDollar } from '@posthog/core'
import { Properties } from '../types'
import Config from '../config'
import { each, extend, extendArray, stripEmptyProperties } from './index'
import { document, location, userAgent, window } from './globals'
import { detectBrowser, detectBrowserVersion, detectDevice, detectDeviceType, detectOS } from './user-agent-utils'
import { cookieStore } from '../storage'

const URL_REGEX_PREFIX = 'https?://(.*)'

// CAMPAIGN_PARAMS and EVENT_TO_PERSON_PROPERTIES should be kept in sync with
// https://github.com/PostHog/posthog/blob/master/plugin-server/src/utils/db/utils.ts#L60

// The list of campaign parameters that could be considered personal data under e.g. GDPR.
// These can be masked in URLs and properties before being sent to posthog.
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

export const CAMPAIGN_PARAMS = extendArray(
    [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'gad_source', // google ads source
        'mc_cid', // mailchimp campaign id
    ],
    PERSONAL_DATA_CAMPAIGN_PARAMS
)

export const EVENT_TO_PERSON_PROPERTIES = [
    // mobile params
    '$app_build',
    '$app_name',
    '$app_namespace',
    '$app_version',
    // web params
    '$browser',
    '$browser_version',
    '$device_type',
    '$current_url',
    '$pathname',
    '$os',
    '$os_name', // $os_name is a special case, it's treated as an alias of $os!
    '$os_version',
    '$referring_domain',
    '$referrer',
    '$screen_height',
    '$screen_width',
    '$viewport_height',
    '$viewport_width',
    '$raw_user_agent',
]

export const MASKED = '<masked>'

// Campaign params that can be read from the cookie store
export const COOKIE_CAMPAIGN_PARAMS = [
    'li_fat_id', // linkedin
]

export function getCampaignParams(
    customTrackedParams?: string[],
    maskPersonalDataProperties?: boolean,
    customPersonalDataProperties?: string[] | undefined
): Record<string, string> {
    if (!document) {
        return {}
    }

    const paramsToMask = maskPersonalDataProperties
        ? extendArray([], PERSONAL_DATA_CAMPAIGN_PARAMS, customPersonalDataProperties || [])
        : []

    // Initially get campaign params from the URL
    const urlCampaignParams = _getCampaignParamsFromUrl(
        maskQueryParams(document.URL, paramsToMask, MASKED),
        customTrackedParams
    )

    // But we can also get some of them from the cookie store
    // For example: https://learn.microsoft.com/en-us/linkedin/marketing/conversions/enabling-first-party-cookies?view=li-lms-2025-05#reading-li_fat_id-from-cookies
    const cookieCampaignParams = _getCampaignParamsFromCookie()

    // Prefer the values found in the urlCampaignParams if possible
    // `extend` will override the values if found in the second argument
    return extend(cookieCampaignParams, urlCampaignParams)
}

function _getCampaignParamsFromUrl(url: string, customParams?: string[]): Record<string, string> {
    const campaign_keywords = CAMPAIGN_PARAMS.concat(customParams || [])

    const params: Record<string, any> = {}
    each(campaign_keywords, function (kwkey) {
        const kw = getQueryParam(url, kwkey)
        params[kwkey] = kw ? kw : null
    })

    return params
}

function _getCampaignParamsFromCookie(): Record<string, string> {
    const params: Record<string, any> = {}
    each(COOKIE_CAMPAIGN_PARAMS, function (kwkey) {
        const kw = cookieStore._get(kwkey)
        params[kwkey] = kw ? kw : null
    })

    return params
}

function _getSearchEngine(referrer: string): string | null {
    if (!referrer) {
        return null
    } else {
        if (referrer.search(URL_REGEX_PREFIX + 'google.([^/?]*)') === 0) {
            return 'google'
        } else if (referrer.search(URL_REGEX_PREFIX + 'bing.com') === 0) {
            return 'bing'
        } else if (referrer.search(URL_REGEX_PREFIX + 'yahoo.com') === 0) {
            return 'yahoo'
        } else if (referrer.search(URL_REGEX_PREFIX + 'duckduckgo.com') === 0) {
            return 'duckduckgo'
        } else {
            return null
        }
    }
}

function _getSearchInfoFromReferrer(referrer: string): Record<string, any> {
    const search = _getSearchEngine(referrer)
    const param = search != 'yahoo' ? 'q' : 'p'
    const ret: Record<string, any> = {}

    if (!isNull(search)) {
        ret['$search_engine'] = search

        const keyword = document ? getQueryParam(document.referrer, param) : ''
        if (keyword.length) {
            ret['ph_keyword'] = keyword
        }
    }

    return ret
}

export function getSearchInfo(): Record<string, any> {
    const referrer = document?.referrer
    if (!referrer) {
        return {}
    }
    return _getSearchInfoFromReferrer(referrer)
}

export function getBrowserLanguage(): string | undefined {
    return (
        navigator.language || // Any modern browser
        (navigator as Record<string, any>).userLanguage // IE11
    )
}

export function getBrowserLanguagePrefix(): string | undefined {
    const lang = getBrowserLanguage()
    return typeof lang === 'string' ? lang.split('-')[0] : undefined
}

export function getReferrer(): string {
    return document?.referrer || '$direct'
}

export function getReferringDomain(): string {
    if (!document?.referrer) {
        return '$direct'
    }
    return convertToURL(document.referrer)?.host || '$direct'
}

export function getReferrerInfo(): Record<string, any> {
    return {
        $referrer: getReferrer(),
        $referring_domain: getReferringDomain(),
    }
}

export function getPersonInfo(maskPersonalDataProperties?: boolean, customPersonalDataProperties?: string[]) {
    const paramsToMask = maskPersonalDataProperties
        ? extendArray([], PERSONAL_DATA_CAMPAIGN_PARAMS, customPersonalDataProperties || [])
        : []
    const url = location?.href.substring(0, 1000)
    // we're being a bit more economical with bytes here because this is stored in the cookie
    return {
        r: getReferrer().substring(0, 1000),
        u: url ? maskQueryParams(url, paramsToMask, MASKED) : undefined,
    }
}

export function getPersonPropsFromInfo(info: Record<string, any>): Record<string, any> {
    const { r: referrer, u: url } = info
    const referring_domain =
        referrer == null ? undefined : referrer == '$direct' ? '$direct' : convertToURL(referrer)?.host

    const props: Record<string, string | undefined> = {
        $referrer: referrer,
        $referring_domain: referring_domain,
    }
    if (url) {
        props['$current_url'] = url
        const location = convertToURL(url)
        props['$host'] = location?.host
        props['$pathname'] = location?.pathname
        const campaignParams = _getCampaignParamsFromUrl(url)
        extend(props, campaignParams)
    }
    if (referrer) {
        const searchInfo = _getSearchInfoFromReferrer(referrer)
        extend(props, searchInfo)
    }
    return props
}

export function getInitialPersonPropsFromInfo(info: Record<string, any>): Record<string, any> {
    const personProps = getPersonPropsFromInfo(info)
    const props: Record<string, any> = {}
    each(personProps, function (val: any, key: string) {
        props[`$initial_${stripLeadingDollar(key)}`] = val
    })
    return props
}

export function getTimezone(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
        return undefined
    }
}

export function getTimezoneOffset(): number | undefined {
    try {
        return new Date().getTimezoneOffset()
    } catch {
        return undefined
    }
}

export function getEventProperties(
    maskPersonalDataProperties?: boolean,
    customPersonalDataProperties?: string[]
): Properties {
    if (!userAgent) {
        return {}
    }
    const paramsToMask = maskPersonalDataProperties
        ? extendArray([], PERSONAL_DATA_CAMPAIGN_PARAMS, customPersonalDataProperties || [])
        : []
    const [os_name, os_version] = detectOS(userAgent)
    return extend(
        stripEmptyProperties({
            $os: os_name,
            $os_version: os_version,
            $browser: detectBrowser(userAgent, navigator.vendor),
            $device: detectDevice(userAgent),
            $device_type: detectDeviceType(userAgent),
            $timezone: getTimezone(),
            $timezone_offset: getTimezoneOffset(),
        }),
        {
            $current_url: maskQueryParams(location?.href, paramsToMask, MASKED),
            $host: location?.host,
            $pathname: location?.pathname,
            $raw_user_agent: userAgent.length > 1000 ? userAgent.substring(0, 997) + '...' : userAgent,
            $browser_version: detectBrowserVersion(userAgent, navigator.vendor),
            $browser_language: getBrowserLanguage(),
            $browser_language_prefix: getBrowserLanguagePrefix(),
            $screen_height: window?.screen.height,
            $screen_width: window?.screen.width,
            $viewport_height: window?.innerHeight,
            $viewport_width: window?.innerWidth,
            $lib: 'web',
            $lib_version: Config.LIB_VERSION,
            $insert_id: Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10),
            $time: Date.now() / 1000, // epoch time in seconds
        }
    )
}
