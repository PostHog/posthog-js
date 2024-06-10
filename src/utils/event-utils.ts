import { getQueryParam, convertToURL } from './request-utils'
import { isNull } from './type-utils'
import { Properties } from '../types'
import Config from '../config'
import { each, extend, stripEmptyProperties, stripLeadingDollar, timestamp } from './index'
import { document, location, userAgent, window } from './globals'
import { detectBrowser, detectBrowserVersion, detectDevice, detectDeviceType, detectOS } from './user-agent-utils'

const URL_REGEX_PREFIX = 'https?://(.*)'

// Should be kept in sync with https://github.com/PostHog/posthog/blob/master/plugin-server/src/utils/db/utils.ts#L60
export const CAMPAIGN_PARAMS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'gclid', // google ads
    'gad_source', // google ads
    'gclsrc', // google ads 360
    'dclid', // google display ads
    'gbraid', // google ads, web to app
    'wbraid', // google ads, app to web
    'fbclid', // facebook
    'msclkid', // microsoft
    'twclid', // twitter
    'li_fat_id', // linkedin
    'mc_cid', // mailchimp campaign id
    'igshid', // instagram
    'ttclid', // tiktok
]

export const Info = {
    campaignParams: function (customParams?: string[]): Record<string, string> {
        if (!document) {
            return {}
        }
        return this._campaignParamsFromUrl(document.URL, customParams)
    },

    _campaignParamsFromUrl: function (url: string, customParams?: string[]): Record<string, string> {
        const campaign_keywords = CAMPAIGN_PARAMS.concat(customParams || [])

        const params: Record<string, any> = {}
        each(campaign_keywords, function (kwkey) {
            const kw = getQueryParam(url, kwkey)
            if (kw) {
                params[kwkey] = kw
            }
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

    browserLanguage: function (): string {
        return (
            navigator.language || // Any modern browser
            (navigator as Record<string, any>).userLanguage // IE11
        )
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

    initialPersonInfo: function (): Record<string, any> {
        // we're being a bit more economical with bytes here because this is stored in the cookie
        return {
            r: this.referrer(),
            u: location?.href,
        }
    },

    initialPersonPropsFromInfo: function (info: Record<string, any>): Record<string, any> {
        const { r: initial_referrer, u: initial_current_url } = info
        const referring_domain =
            initial_referrer == null
                ? undefined
                : initial_referrer == '$direct'
                ? '$direct'
                : convertToURL(initial_referrer)?.host

        const props: Record<string, string | undefined> = {
            $initial_referrer: initial_referrer,
            $initial_referring_domain: referring_domain,
        }
        if (initial_current_url) {
            props['$initial_current_url'] = initial_current_url
            const location = convertToURL(initial_current_url)
            props['$initial_host'] = location?.host
            props['$initial_pathname'] = location?.pathname
            const campaignParams = this._campaignParamsFromUrl(initial_current_url)
            each(campaignParams, function (v, k: string) {
                props['$initial_' + stripLeadingDollar(k)] = v
            })
        }
        if (initial_referrer) {
            const searchInfo = this._searchInfoFromReferrer(initial_referrer)
            each(searchInfo, function (v, k: string) {
                props['$initial_' + stripLeadingDollar(k)] = v
            })
        }
        return props
    },

    properties: function (): Properties {
        if (!userAgent) {
            return {}
        }
        const [os_name, os_version] = Info.os(userAgent)
        return extend(
            stripEmptyProperties({
                $os: os_name,
                $os_version: os_version,
                $browser: Info.browser(userAgent, navigator.vendor),
                $device: Info.device(userAgent),
                $device_type: Info.deviceType(userAgent),
            }),
            {
                $current_url: location?.href,
                $host: location?.host,
                $pathname: location?.pathname,
                $raw_user_agent: userAgent.length > 1000 ? userAgent.substring(0, 997) + '...' : userAgent,
                $browser_version: Info.browserVersion(userAgent, navigator.vendor),
                $browser_language: Info.browserLanguage(),
                $screen_height: window?.screen.height,
                $screen_width: window?.screen.width,
                $viewport_height: window?.innerHeight,
                $viewport_width: window?.innerWidth,
                $lib: 'web',
                $lib_version: Config.LIB_VERSION,
                $insert_id: Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10),
                $time: timestamp() / 1000, // epoch time in seconds
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
