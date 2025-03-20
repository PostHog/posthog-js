import { getQueryParam, convertToURL, maskQueryParams } from './request-utils'
import { isNull } from './type-utils'
import { Properties } from '../types'
import Config from '../config'
import { each, extend, extendArray, stripEmptyProperties } from './index'
import { document, location, userAgent, window } from './globals'
import { detectBrowser, detectBrowserVersion, detectDevice, detectDeviceType, detectOS } from './user-agent-utils'
import { stripLeadingDollar } from './string-utils'

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

export const Info = {
    campaignParams: function ({
        customTrackedParams,
        maskPersonalDataProperties,
        customPersonalDataProperties,
    }: {
        customTrackedParams?: string[]
        maskPersonalDataProperties?: boolean
        customPersonalDataProperties?: string[] | undefined
    } = {}): Record<string, string> {
        if (!document) {
            return {}
        }

        const paramsToMask = maskPersonalDataProperties
            ? extendArray([], PERSONAL_DATA_CAMPAIGN_PARAMS, customPersonalDataProperties || [])
            : []

        return this._campaignParamsFromUrl(maskQueryParams(document.URL, paramsToMask, MASKED), customTrackedParams)
    },

    _campaignParamsFromUrl: function (url: string, customParams?: string[]): Record<string, string> {
        const campaign_keywords = CAMPAIGN_PARAMS.concat(customParams || [])

        const params: Record<string, any> = {}
        each(campaign_keywords, function (kwkey) {
            const kw = getQueryParam(url, kwkey)
            params[kwkey] = kw ? kw : null
        })

        return params
    },

    _searchEngine: function (referrer: string): string | null {
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
    },

    _searchInfoFromReferrer: function (referrer: string): Record<string, any> {
        const search = Info._searchEngine(referrer)
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
    },

    searchInfo: function (): Record<string, any> {
        const referrer = document?.referrer
        if (!referrer) {
            return {}
        }
        return this._searchInfoFromReferrer(referrer)
    },

    /**
     * This function detects which browser is running this script.
     * The order of the checks are important since many user agents
     * include keywords used in later checks.
     */
    browser: detectBrowser,

    /**
     * This function detects which browser version is running this script,
     * parsing major and minor version (e.g., 42.1). User agent strings from:
     * http://www.useragentstring.com/pages/useragentstring.php
     *
     * `navigator.vendor` is passed in and used to help with detecting certain browsers
     * NB `navigator.vendor` is deprecated and not present in every browser
     */
    browserVersion: detectBrowserVersion,

    browserLanguage: function (): string | undefined {
        return (
            navigator.language || // Any modern browser
            (navigator as Record<string, any>).userLanguage // IE11
        )
    },

    browserLanguagePrefix: function (): string | undefined {
        const browserLanguage = this.browserLanguage()
        return typeof browserLanguage === 'string' ? browserLanguage.split('-')[0] : undefined
    },

    os: detectOS,

    device: detectDevice,

    deviceType: detectDeviceType,

    referrer: function (): string {
        return document?.referrer || '$direct'
    },

    referringDomain: function (): string {
        if (!document?.referrer) {
            return '$direct'
        }
        return convertToURL(document.referrer)?.host || '$direct'
    },

    referrerInfo: function (): Record<string, any> {
        return {
            $referrer: this.referrer(),
            $referring_domain: this.referringDomain(),
        }
    },

    personInfo: function ({
        maskPersonalDataProperties,
        customPersonalDataProperties,
    }: {
        maskPersonalDataProperties?: boolean
        customPersonalDataProperties?: string[]
    } = {}) {
        const paramsToMask = maskPersonalDataProperties
            ? extendArray([], PERSONAL_DATA_CAMPAIGN_PARAMS, customPersonalDataProperties || [])
            : []
        const url = location?.href.substring(0, 1000)
        // we're being a bit more economical with bytes here because this is stored in the cookie
        return {
            r: this.referrer().substring(0, 1000),
            u: url ? maskQueryParams(url, paramsToMask, MASKED) : undefined,
        }
    },

    personPropsFromInfo: function (info: Record<string, any>): Record<string, any> {
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
            const campaignParams = this._campaignParamsFromUrl(url)
            extend(props, campaignParams)
        }
        if (referrer) {
            const searchInfo = this._searchInfoFromReferrer(referrer)
            extend(props, searchInfo)
        }
        return props
    },

    initialPersonPropsFromInfo: function (info: Record<string, any>): Record<string, any> {
        const personProps = this.personPropsFromInfo(info)
        const props: Record<string, any> = {}
        each(personProps, function (val: any, key: string) {
            props[`$initial_${stripLeadingDollar(key)}`] = val
        })
        return props
    },

    timezone: function (): string | undefined {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone
        } catch {
            return undefined
        }
    },

    timezoneOffset: function (): number | undefined {
        try {
            return new Date().getTimezoneOffset()
        } catch {
            return undefined
        }
    },

    properties: function ({
        maskPersonalDataProperties,
        customPersonalDataProperties,
    }: {
        maskPersonalDataProperties?: boolean
        customPersonalDataProperties?: string[]
    } = {}): Properties {
        if (!userAgent) {
            return {}
        }
        const paramsToMask = maskPersonalDataProperties
            ? extendArray([], PERSONAL_DATA_CAMPAIGN_PARAMS, customPersonalDataProperties || [])
            : []
        const [os_name, os_version] = Info.os(userAgent)
        return extend(
            stripEmptyProperties({
                $os: os_name,
                $os_version: os_version,
                $browser: Info.browser(userAgent, navigator.vendor),
                $device: Info.device(userAgent),
                $device_type: Info.deviceType(userAgent),
                $timezone: Info.timezone(),
                $timezone_offset: Info.timezoneOffset(),
            }),
            {
                $current_url: maskQueryParams(location?.href, paramsToMask, MASKED),
                $host: location?.host,
                $pathname: location?.pathname,
                $raw_user_agent: userAgent.length > 1000 ? userAgent.substring(0, 997) + '...' : userAgent,
                $browser_version: Info.browserVersion(userAgent, navigator.vendor),
                $browser_language: Info.browserLanguage(),
                $browser_language_prefix: Info.browserLanguagePrefix(),
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
    },

    people_properties: function (): Properties {
        if (!userAgent) {
            return {}
        }

        const [os_name, os_version] = Info.os(userAgent)
        return extend(
            stripEmptyProperties({
                $os: os_name,
                $os_version: os_version,
                $browser: Info.browser(userAgent, navigator.vendor),
            }),
            {
                $browser_version: Info.browserVersion(userAgent, navigator.vendor),
            }
        )
    },
}
