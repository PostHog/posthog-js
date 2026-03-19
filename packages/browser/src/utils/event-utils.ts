import { convertToURL, getQueryParam, maskQueryParams } from './request-utils'
import { isNull, stripLeadingDollar } from '@posthog/core'
import { Properties } from '../types'
import Config from '../config'
import { extend, extendArray } from './index'
import { document, location, userAgent, window } from './globals'
import { detectBrowser, detectBrowserVersion, detectDevice, detectDeviceType, detectOS } from '@posthog/core'
import { cookieStore } from '../storage'

const URL_REGEX_PREFIX = 'https?://(.*)'

// Pre-compiled search engine regex patterns to avoid creating strings on every call
const _searchEngineRegex = {
    google: new RegExp(URL_REGEX_PREFIX + 'google.([^/?]*)'),
    bing: new RegExp(URL_REGEX_PREFIX + 'bing.com'),
    yahoo: new RegExp(URL_REGEX_PREFIX + 'yahoo.com'),
    duckduckgo: new RegExp(URL_REGEX_PREFIX + 'duckduckgo.com'),
}

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
        : undefined

    // Initially get campaign params from the URL
    const urlCampaignParams = _getCampaignParamsFromUrl(
        paramsToMask ? maskQueryParams(document.URL, paramsToMask, MASKED) : document.URL,
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
    const campaign_keywords = customParams?.length ? CAMPAIGN_PARAMS.concat(customParams) : CAMPAIGN_PARAMS

    // Parse query string once instead of calling getQueryParam N times
    // (each call splits the URL, hash, and query string independently)
    const withoutHash: string = url.split('#')[0] || ''
    const queryString: string = (withoutHash.split(/\?(.*)/)[1] || '').replace(/^\?+/g, '')

    // Build a lookup of query params from the URL
    const queryLookup: Record<string, string> = {}
    if (queryString) {
        const queryParts = queryString.split('&')
        for (let i = 0; i < queryParts.length; i++) {
            const eqIdx = queryParts[i].indexOf('=')
            if (eqIdx > 0) {
                const key = queryParts[i].substring(0, eqIdx)
                let value = queryParts[i].substring(eqIdx + 1)
                try {
                    value = decodeURIComponent(value)
                } catch {
                    // noop
                }
                queryLookup[key] = value
            }
        }
    }

    const params: Record<string, any> = {}
    for (let i = 0; i < campaign_keywords.length; i++) {
        const kwkey = campaign_keywords[i]
        params[kwkey] = queryLookup[kwkey] || null
    }

    return params
}

function _getCampaignParamsFromCookie(): Record<string, string> {
    const params: Record<string, any> = {}
    for (let i = 0; i < COOKIE_CAMPAIGN_PARAMS.length; i++) {
        const kwkey = COOKIE_CAMPAIGN_PARAMS[i]
        const kw = cookieStore._get(kwkey)
        params[kwkey] = kw ? kw : null
    }

    return params
}

function _getSearchEngine(referrer: string): string | null {
    if (!referrer) {
        return null
    } else {
        if (_searchEngineRegex.google.test(referrer)) {
            return 'google'
        } else if (_searchEngineRegex.bing.test(referrer)) {
            return 'bing'
        } else if (_searchEngineRegex.yahoo.test(referrer)) {
            return 'yahoo'
        } else if (_searchEngineRegex.duckduckgo.test(referrer)) {
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
        : undefined
    const url = location?.href.substring(0, 1000)
    // we're being a bit more economical with bytes here because this is stored in the cookie
    return {
        r: getReferrer().substring(0, 1000),
        u: url ? (paramsToMask ? maskQueryParams(url, paramsToMask, MASKED) : url) : undefined,
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
    const keys = Object.keys(personProps)
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        props[`$initial_${stripLeadingDollar(key)}`] = personProps[key]
    }
    return props
}

// Cache timezone since it doesn't change during a page session
let _cachedTimezone: string | undefined | null = null
export function getTimezone(): string | undefined {
    if (_cachedTimezone === null) {
        try {
            _cachedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        } catch {
            _cachedTimezone = undefined
        }
    }
    return _cachedTimezone
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
        : undefined
    const [os_name, os_version] = detectOS(userAgent)

    // Build properties in a single object to avoid intermediate allocations
    const properties: Properties = {
        $current_url: paramsToMask ? maskQueryParams(location?.href, paramsToMask, MASKED) : location?.href,
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
        $lib: Config.LIB_NAME,
        $lib_version: Config.LIB_VERSION,
        $insert_id: Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10),
        $time: Date.now() / 1000, // epoch time in seconds
    }

    // Add optional OS/browser/device properties directly (avoids stripEmptyProperties + extend)
    if (os_name) {
        properties.$os = os_name
    }
    if (os_version) {
        properties.$os_version = os_version
    }
    const browser = detectBrowser(userAgent, navigator.vendor)
    if (browser) {
        properties.$browser = browser
    }
    const device = detectDevice(userAgent)
    if (device) {
        properties.$device = device
    }
    const deviceType = detectDeviceType(userAgent, {
        // eslint-disable-next-line compat/compat
        userAgentDataPlatform: navigator?.userAgentData?.platform,
        maxTouchPoints: navigator?.maxTouchPoints,
        screenWidth: window?.screen?.width,
        screenHeight: window?.screen?.height,
        devicePixelRatio: window?.devicePixelRatio,
    })
    if (deviceType) {
        properties.$device_type = deviceType
    }
    const timezone = getTimezone()
    if (timezone) {
        properties.$timezone = timezone
    }
    const timezoneOffset = getTimezoneOffset()
    if (timezoneOffset !== undefined) {
        properties.$timezone_offset = timezoneOffset
    }

    return properties
}
