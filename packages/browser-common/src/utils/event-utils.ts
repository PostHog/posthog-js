import { getTimezone } from './timezone'
export { getTimezone } from './timezone'
import { convertToURL, getQueryParam } from './request-utils'
import { isNull, isUndefined, stripLeadingDollar, stripUrlHash } from '@posthog/core'
import type { Properties, UrlSanitizationOptions } from '@posthog/types'
import { getRecordedUrl, PERSONAL_DATA_CAMPAIGN_PARAMS } from './url-sanitization'
import type { RecordedUrlConfig } from './url-sanitization'
import Config from '../config'
import { SDK_DIST_CHANNEL } from '../constants'
import { each, extend, stripEmptyProperties } from './general-utils'
import { document, location, userAgent, window } from './globals'
import type { BrowserDetectionHints, BrowserDetectionOptions } from '@posthog/core'
import {
    detectBrowser,
    detectBrowserVersion,
    detectDevice,
    detectDeviceType,
    detectOS,
    detectWebviewApp,
} from '@posthog/core'
import { getCookieValue } from './cookie-utils'

const URL_REGEX_PREFIX = 'https?://(.*)'

// CAMPAIGN_PARAMS and EVENT_TO_PERSON_PROPERTIES should be kept in sync with
// https://github.com/PostHog/posthog/blob/master/plugin-server/src/utils/db/utils.ts#L60

export { PERSONAL_DATA_CAMPAIGN_PARAMS, MASKED } from './url-sanitization'
export const CAMPAIGN_PARAMS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'gad_source', // google ads source
    'mc_cid', // mailchimp campaign id
    ...PERSONAL_DATA_CAMPAIGN_PARAMS,
]

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

// Campaign params that can be read from the cookie store
export const COOKIE_CAMPAIGN_PARAMS = [
    'li_fat_id', // linkedin
]

export function getCampaignParams(
    customTrackedParams?: string[],
    maskPersonalDataProperties?: boolean,
    customPersonalDataProperties?: string[] | undefined,
    urlSanitization?: UrlSanitizationOptions
): Record<string, string> {
    if (!document) {
        return {}
    }

    // Initially get campaign params from the URL
    const urlCampaignParams = _getCampaignParamsFromUrl(
        getRecordedUrl(
            document.URL,
            {
                url_sanitization: urlSanitization,
                mask_personal_data_properties: maskPersonalDataProperties,
                custom_personal_data_properties: customPersonalDataProperties,
            },
            { maskQuery: true, stripHash: false }
        ) || '',
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
        const kw = getCookieValue(kwkey)
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

function _getSearchInfoFromReferrer(referrer: string, useRecordedReferrer = false): Record<string, any> {
    const search = _getSearchEngine(referrer)
    const param = search != 'yahoo' ? 'q' : 'p'
    const ret: Record<string, any> = {}

    if (!isNull(search)) {
        ret['$search_engine'] = search

        const keyword = getQueryParam(useRecordedReferrer ? referrer : document?.referrer || '', param)
        if (keyword.length) {
            ret['ph_keyword'] = keyword
        }
    }

    return ret
}

export function getSearchInfo(config: RecordedUrlConfig = {}): Record<string, any> {
    const referrer = getRecordedUrl(document?.referrer, config, { stripHash: false })
    if (!referrer) {
        return {}
    }
    return _getSearchInfoFromReferrer(referrer, !!config.url_sanitization)
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

const DIRECT = '$direct'

export function getReferrer(): string {
    return document?.referrer || DIRECT
}

export function getReferringDomain(): string {
    if (!document?.referrer) {
        return DIRECT
    }
    return convertToURL(document.referrer)?.host || DIRECT
}

export function getReferrerInfo(config: RecordedUrlConfig = {}): Record<string, any> {
    if (!config.url_sanitization || !document?.referrer) {
        return { $referrer: getReferrer(), $referring_domain: getReferringDomain() }
    }
    const referrer = getRecordedUrl(document.referrer, config, { stripHash: false })
    return referrer ? { $referrer: referrer, $referring_domain: convertToURL(referrer)?.host } : {}
}

export function getPersonInfo(
    maskPersonalDataProperties?: boolean,
    customPersonalDataProperties?: string[],
    disableCaptureUrlHashes: boolean = false,
    urlSanitization?: UrlSanitizationOptions
) {
    const config = {
        mask_personal_data_properties: maskPersonalDataProperties,
        custom_personal_data_properties: customPersonalDataProperties,
        disable_capture_url_hashes: disableCaptureUrlHashes,
        url_sanitization: urlSanitization,
    }
    // Keep legacy truncation before query masking. Callbacks need the complete URL before truncation.
    const href = disableCaptureUrlHashes ? stripUrlHash(location?.href) : location?.href
    const input = urlSanitization ? location?.href : href?.substring(0, 1000)
    const referrer = getRecordedUrl(document?.referrer, config, { stripHash: false })
    const url = getRecordedUrl(input, config, { maskQuery: true, stripHash: false })
    return {
        r: document?.referrer ? referrer?.substring(0, 1000) : DIRECT,
        u: urlSanitization ? url?.substring(0, 1000) : url,
    }
}

export function getPersonPropsFromInfo(
    info: Record<string, any>,
    disableCaptureUrlHashes: boolean = false,
    urlSanitization?: UrlSanitizationOptions
): Record<string, any> {
    const { r: referrer, u } = info
    // Stored values were sanitized before persistence; do not run application callbacks again on reads.
    const url = (urlSanitization?.hash ?? !disableCaptureUrlHashes) ? u : stripUrlHash(u)
    const referring_domain = referrer == null ? undefined : referrer == DIRECT ? DIRECT : convertToURL(referrer)?.host

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
        const searchInfo = _getSearchInfoFromReferrer(referrer, !!urlSanitization)
        extend(props, searchInfo)
    }
    return props
}

export function getInitialPersonPropsFromInfo(
    info: Record<string, any>,
    disableCaptureUrlHashes: boolean = false,
    urlSanitization?: UrlSanitizationOptions
): Record<string, any> {
    const personProps = getPersonPropsFromInfo(info, disableCaptureUrlHashes, urlSanitization)
    const props: Record<string, any> = {}
    each(personProps, function (val: any, key: string) {
        props[`$initial_${stripLeadingDollar(key)}`] = val
    })
    return props
}

export function getTimezoneOffset(): number | undefined {
    try {
        return new Date().getTimezoneOffset()
    } catch {
        return undefined
    }
}

// Gathers signals that aren't in the UA string. Desktop / Android Brave is
// Chromium-based and exposes `navigator.brave` rather than a UA marker. (Brave
// on iOS is picked up via the `Brave/` UA marker by `detectBrowser` itself, so
// no hint is needed there.)
export function getBrowserDetectionHints(): BrowserDetectionHints {
    const nav = typeof navigator !== 'undefined' ? (navigator as Record<string, any>) : undefined
    return nav?.brave ? { brave: true } : {}
}

export function getEventProperties(
    maskPersonalDataProperties?: boolean,
    customPersonalDataProperties?: string[],
    detectGoogleSearchApp?: boolean,
    disableCaptureUrlHashes: boolean = false,
    urlSanitization?: UrlSanitizationOptions
): Properties {
    if (!userAgent) {
        return {}
    }
    const currentUrl = getRecordedUrl(
        location?.href,
        {
            mask_personal_data_properties: maskPersonalDataProperties,
            custom_personal_data_properties: customPersonalDataProperties,
            disable_capture_url_hashes: disableCaptureUrlHashes,
            url_sanitization: urlSanitization,
        },
        { maskQuery: true }
    )
    const recordedLocation = urlSanitization ? (currentUrl ? convertToURL(currentUrl) : undefined) : location
    const [os_name, os_version] = detectOS(userAgent)
    const [webviewApp, webviewAppVersion] = detectWebviewApp(userAgent)
    const browserHints = getBrowserDetectionHints()
    const browserOptions: BrowserDetectionOptions = {}
    if (!isUndefined(detectGoogleSearchApp)) {
        browserOptions.detectGoogleSearchApp = detectGoogleSearchApp
    }

    type DeviceDetectionOptions = NonNullable<Parameters<typeof detectDeviceType>[1]>
    const deviceOptions: DeviceDetectionOptions = {}
    // oxlint-disable-next-line compat/compat
    const userAgentDataPlatform = navigator?.userAgentData?.platform
    const maxTouchPoints = navigator?.maxTouchPoints
    const screenWidth = window?.screen?.width
    const screenHeight = window?.screen?.height
    const devicePixelRatio = window?.devicePixelRatio
    if (!isUndefined(userAgentDataPlatform)) {
        deviceOptions.userAgentDataPlatform = userAgentDataPlatform
    }
    if (!isUndefined(maxTouchPoints)) {
        deviceOptions.maxTouchPoints = maxTouchPoints
    }
    if (!isUndefined(screenWidth)) {
        deviceOptions.screenWidth = screenWidth
    }
    if (!isUndefined(screenHeight)) {
        deviceOptions.screenHeight = screenHeight
    }
    if (!isUndefined(devicePixelRatio)) {
        deviceOptions.devicePixelRatio = devicePixelRatio
    }

    const properties = extend(
        stripEmptyProperties({
            $os: os_name,
            $os_version: os_version,
            $browser: detectBrowser(userAgent, navigator.vendor, browserHints, browserOptions),
            $webview_app: webviewApp,
            $webview_app_version: webviewAppVersion,
            $device: detectDevice(userAgent),
            $device_type: detectDeviceType(userAgent, deviceOptions),
            $timezone: getTimezone(),
            $timezone_offset: getTimezoneOffset(),
        }),
        {
            $current_url: currentUrl,
            $host: recordedLocation?.host,
            $pathname: recordedLocation?.pathname,
            $raw_user_agent: userAgent.length > 1000 ? userAgent.substring(0, 997) + '...' : userAgent,
            $browser_version: detectBrowserVersion(userAgent, navigator.vendor, browserHints, browserOptions),
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
    )

    if (Config.SDK_DIST_CHANNEL) {
        properties[SDK_DIST_CHANNEL] = Config.SDK_DIST_CHANNEL
    }

    return properties
}
