import { _getQueryParam, convertToURL } from './request-utils'
import { _isNull, _isUndefined } from './type-utils'
import { Properties } from '../types'
import Config from '../config'
import { _each, _extend, _includes, _strip_empty_properties, _timestamp } from './index'
import { document, window, location, userAgent, assignableWindow } from './globals'

const ANDROID = 'Android'
const ANDROID_TABLET = `${ANDROID} Tablet`
const IPAD = 'iPad'
const APPLE = 'Apple'
const APPLE_WATCH = `${APPLE} Watch`
const SAFARI = 'Safari'
const BLACKBERRY = 'BlackBerry'
const CHROME = 'Chrome'
const CHROME_OS = `${CHROME} OS`
const CHROME_IOS = `${CHROME} iOS`
const INTERNET_EXPLORER = 'Internet Explorer'
const INTERNET_EXPLORER_MOBILE = `${INTERNET_EXPLORER} Mobile`
const MICROSOFT = 'Microsoft'
const EDGE = 'Edge'
const MICROSOFT_EDGE = `${MICROSOFT} ${EDGE}`
const FIREFOX = 'Firefox'
const FIREFOX_IOS = `${FIREFOX} iOS`
const NINTENDO = 'Nintendo'
const PLAYSTATION = 'PlayStation'
const XBOX = 'Xbox'

const BROWSER_VERSION_REGEX_SUFFIX = '(\\d+(\\.\\d+)?)'
const DEFAULT_BROWSER_VERSION_REGEX = new RegExp(`Version\\/${BROWSER_VERSION_REGEX_SUFFIX}`)

const XBOX_REGEX = new RegExp(`${XBOX}`, 'i')
const PLAYSTATION_REGEX = new RegExp(`${PLAYSTATION} \\w+`, 'i')
const NINTENDO_REGEX = new RegExp(`${NINTENDO} \\w+`, 'i')
const BLACKBERRY_BROWSER_REGEX = new RegExp(`${BLACKBERRY}|PlayBook|BB10`, 'i')

const URL_REGEX_PREFIX = 'https?://(.*)'

const windowsVersionMap: Record<string, string> = {
    'NT3.51': 'NT 3.11',
    'NT4.0': 'NT 4.0',
    '5.0': '2000',
    '5.1': 'XP',
    '5.2': 'XP',
    '6.0': 'Vista',
    '6.1': '7',
    '6.2': '8',
    '6.3': '8.1',
    '6.4': '10',
    '10.0': '10',
}

/**
 * Safari detection turns out to be complicated. For e.g. https://stackoverflow.com/a/29696509
 * We can be slightly loose because some options have been ruled out (e.g. firefox on iOS)
 * before this check is made
 */
function isSafari(userAgent: string): boolean {
    return _includes(userAgent, SAFARI) && !_includes(userAgent, CHROME) && !_includes(userAgent, ANDROID)
}

export const _info = {
    campaignParams: function (customParams?: string[]): Record<string, any> {
        // Should be kept in sync with https://github.com/PostHog/posthog/blob/master/plugin-server/src/utils/db/utils.ts#L60
        const campaign_keywords = [
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_content',
            'utm_term',
            'gclid',
            'gad_source',
            'gbraid',
            'wbraid',
            'fbclid',
            'msclkid',
        ].concat(customParams || [])

        const params: Record<string, any> = {}
        _each(campaign_keywords, function (kwkey) {
            const kw = document ? _getQueryParam(document.URL, kwkey) : ''
            if (kw.length) {
                params[kwkey] = kw
            }
        })

        return params
    },

    searchEngine: function (): string | null {
        const referrer = document?.referrer
        if (!referrer) {
            return null
        } else {
            if (referrer.search(`${URL_REGEX_PREFIX}google.([^/?]*)`) === 0) {
                return 'google'
            } else if (referrer.search(`${URL_REGEX_PREFIX}bing.com`) === 0) {
                return 'bing'
            } else if (referrer.search(`${URL_REGEX_PREFIX}yahoo.com`) === 0) {
                return 'yahoo'
            } else if (referrer.search(`${URL_REGEX_PREFIX}duckduckgo.com`) === 0) {
                return 'duckduckgo'
            } else {
                return null
            }
        }
    },

    searchInfo: function (): Record<string, any> {
        const search = _info.searchEngine(),
            param = search != 'yahoo' ? 'q' : 'p',
            ret: Record<string, any> = {}

        if (!_isNull(search)) {
            ret['$search_engine'] = search

            const keyword = document ? _getQueryParam(document.referrer, param) : ''
            if (keyword.length) {
                ret['ph_keyword'] = keyword
            }
        }

        return ret
    },

    /**
     * This function detects which browser is running this script.
     * The order of the checks are important since many user agents
     * include key words used in later checks.
     */
    browser: function (user_agent: string, vendor: string | undefined, opera?: any): string {
        vendor = vendor || '' // vendor is undefined for at least IE9
        if (opera || _includes(user_agent, ' OPR/')) {
            if (_includes(user_agent, 'Mini')) {
                return 'Opera Mini'
            }
            return 'Opera'
        } else {
            if (BLACKBERRY_BROWSER_REGEX.test(user_agent)) {
                return BLACKBERRY
            } else if (_includes(user_agent, 'IEMobile') || _includes(user_agent, 'WPDesktop')) {
                return INTERNET_EXPLORER_MOBILE
            } else if (_includes(user_agent, 'SamsungBrowser/')) {
                // https://developer.samsung.com/internet/user-agent-string-format
                return 'Samsung Internet'
            } else if (_includes(user_agent, 'Edge') || _includes(user_agent, 'Edg/')) {
                return MICROSOFT_EDGE
            } else if (_includes(user_agent, 'FBIOS')) {
                return 'Facebook Mobile'
            } else if (_includes(user_agent, CHROME)) {
                return CHROME
            } else if (_includes(user_agent, 'CriOS')) {
                return CHROME_IOS
            } else if (_includes(user_agent, 'UCWEB') || _includes(user_agent, 'UCBrowser')) {
                return 'UC Browser'
            } else if (_includes(user_agent, 'FxiOS')) {
                return FIREFOX_IOS
            } else if (_includes(vendor, APPLE) || isSafari(user_agent)) {
                if (_includes(user_agent, 'Mobile')) {
                    return 'Mobile Safari'
                }
                return SAFARI
            } else if (_includes(user_agent, ANDROID)) {
                return 'Android Mobile'
            } else if (_includes(user_agent, 'Konqueror') || _includes(user_agent, 'konqueror')) {
                return 'Konqueror'
            } else if (_includes(user_agent, FIREFOX)) {
                return FIREFOX
            } else if (_includes(user_agent, 'MSIE') || _includes(user_agent, 'Trident/')) {
                return INTERNET_EXPLORER
            } else if (_includes(user_agent, 'Gecko')) {
                return 'Mozilla'
            } else {
                return ''
            }
        }
    },

    /**
     * This function detects which browser version is running this script,
     * parsing major and minor version (e.g., 42.1). User agent strings from:
     * http://www.useragentstring.com/pages/useragentstring.php
     *
     * `navigator.vendor` is passed in and used to help with detecting certain browsers
     * NB `navigator.vendor` is deprecated and not present in every browser
     */
    browserVersion: function (userAgent: string, vendor: string | undefined, opera: string): number | null {
        const browser = _info.browser(userAgent, vendor, opera)
        const versionRegexes: Record<string, RegExp[]> = {
            [INTERNET_EXPLORER_MOBILE]: [new RegExp(`rv:${BROWSER_VERSION_REGEX_SUFFIX}`)],
            [MICROSOFT_EDGE]: [new RegExp(`${EDGE}?\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
            [CHROME]: [new RegExp(`${CHROME}/${BROWSER_VERSION_REGEX_SUFFIX}`)],
            [CHROME_IOS]: [new RegExp(`CriOS\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
            'UC Browser': [new RegExp(`(UCBrowser|UCWEB)\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
            [SAFARI]: [DEFAULT_BROWSER_VERSION_REGEX],
            'Mobile Safari': [DEFAULT_BROWSER_VERSION_REGEX],
            Opera: [new RegExp(`(Opera|OPR)\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
            [FIREFOX]: [new RegExp(`${FIREFOX}\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
            [FIREFOX_IOS]: [new RegExp(`FxiOS\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
            Konqueror: [new RegExp(`Konqueror[:/]?${BROWSER_VERSION_REGEX_SUFFIX}`, 'i')],
            // not every blackberry user agent has the version after the name
            [BLACKBERRY]: [new RegExp(`${BLACKBERRY} ${BROWSER_VERSION_REGEX_SUFFIX}`), DEFAULT_BROWSER_VERSION_REGEX],
            'Android Mobile': [new RegExp(`android\\s${BROWSER_VERSION_REGEX_SUFFIX}`)],
            'Samsung Internet': [new RegExp(`SamsungBrowser\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
            [INTERNET_EXPLORER]: [new RegExp(`(rv:|MSIE )${BROWSER_VERSION_REGEX_SUFFIX}`)],
            Mozilla: [new RegExp(`rv:${BROWSER_VERSION_REGEX_SUFFIX}`)],
        }
        const regexes: RegExp[] | undefined = versionRegexes[browser as keyof typeof versionRegexes]
        if (_isUndefined(regexes)) {
            return null
        }

        for (let i = 0; i < regexes.length; i++) {
            const regex = regexes[i]
            const matches = userAgent.match(regex)
            if (matches) {
                return parseFloat(matches[matches.length - 2])
            }
        }
        return null
    },

    browserLanguage: function (): string {
        return (
            navigator.language || // Any modern browser
            (navigator as Record<string, any>).userLanguage // IE11
        )
    },

    os: function (user_agent: string): { os_name: string; os_version: string } {
        if (/xbox; xbox (.*?)[);]/i.test(user_agent)) {
            const match = /xbox; xbox (.*?)[);]/i.exec(user_agent)
            if (match && match[1]) {
                return { os_name: 'Xbox', os_version: match[1] }
            }
            return { os_name: 'Xbox', os_version: '' }
        } else if (/(nintendo)/i.test(user_agent)) {
            return { os_name: 'Nintendo', os_version: '' }
        } else if (/(playstation)/i.test(user_agent)) {
            return { os_name: 'PlayStation', os_version: '' }
        } else if (/Windows/i.test(user_agent)) {
            if (/Phone/.test(user_agent) || /WPDesktop/.test(user_agent)) {
                return { os_name: 'Windows Phone', os_version: '' }
            }
            // not all JS versions support negative lookbehind, so we need two checks here
            if (/Mobile\b/.test(user_agent) && !/IEMobile\b/.test(user_agent)) {
                return { os_name: 'Windows Mobile', os_version: '' }
            }
            const match = /Windows NT ([0-9.]+)/i.exec(user_agent)
            if (match && match[1]) {
                const version = match[1]
                let osVersion = windowsVersionMap[version] || ''
                if (/arm/i.test(user_agent)) {
                    osVersion = 'RT'
                }
                return { os_name: 'Windows', os_version: osVersion }
            }
            return { os_name: 'Windows', os_version: '' }
        } else if (/(iPhone|iPad|iPod)/.test(user_agent)) {
            const match = /OS (\d+)_(\d+)_?(\d+)?/i.exec(user_agent)
            if (match && match[1]) {
                const versionParts = [match[1], match[2], match[3] || '0']
                return { os_name: 'iOS', os_version: versionParts.join('.') }
            }
            return { os_name: 'iOS', os_version: '' }
        } else if (/watch|watch os/i.test(user_agent)) {
            // e.g. Watch4,3/5.3.8 (16U680)
            const match = /(watch.*\/(\d+\.\d+\.\d+)|watch os,(\d+\.\d+),)/i.exec(user_agent)
            let version = ''
            if (match && match.length >= 3) {
                version = _isUndefined(match[2]) ? match[3] : match[2]
            }
            return { os_name: 'watchOS', os_version: version }
        } else if (/Android/.test(user_agent)) {
            const match = /Android (\d+)\.(\d+)\.?(\d+)?/i.exec(user_agent)
            if (match && match[1]) {
                const versionParts = [match[1], match[2], match[3] || '0']
                return { os_name: ANDROID, os_version: versionParts.join('.') }
            }
            return { os_name: ANDROID, os_version: '' }
        } else if (/(BlackBerry|PlayBook|BB10)/i.test(user_agent)) {
            return { os_name: BLACKBERRY, os_version: '' }
        } else if (/Mac/i.test(user_agent)) {
            const match = /Mac OS X (\d+)[_.](\d+)[_.]?(\d+)?/i.exec(user_agent)
            if (match && match[1]) {
                const versionParts = [match[1], match[2], match[3] || '0']
                return { os_name: 'Mac OS X', os_version: versionParts.join('.') }
            }
            return { os_name: 'Mac OS X', os_version: '' }
        } else if (/(Linux|debian)/i.test(user_agent)) {
            return { os_name: 'Linux', os_version: '' }
        } else if (/CrOS/.test(user_agent)) {
            return { os_name: CHROME_OS, os_version: '' }
        } else {
            return { os_name: '', os_version: '' }
        }
    },

    // currently described as "the mobile device that was used"
    device: function (user_agent: string): string {
        if (NINTENDO_REGEX.test(user_agent)) {
            return NINTENDO
        } else if (PLAYSTATION_REGEX.test(user_agent)) {
            return PLAYSTATION
        } else if (XBOX_REGEX.test(user_agent)) {
            return XBOX
        } else if (/ouya/i.test(user_agent)) {
            return 'Ouya'
        } else if (/Windows Phone/i.test(user_agent) || /WPDesktop/.test(user_agent)) {
            return 'Windows Phone'
        } else if (/iPad/.test(user_agent)) {
            return IPAD
        } else if (/iPod/.test(user_agent)) {
            return 'iPod Touch'
        } else if (/iPhone/.test(user_agent)) {
            return 'iPhone'
        } else if (/(watch)(?: ?os[,/]|\d,\d\/)[\d.]+/i.test(user_agent)) {
            return APPLE_WATCH
        } else if (BLACKBERRY_BROWSER_REGEX.test(user_agent)) {
            return BLACKBERRY
        } else if (/(kobo)\s(ereader|touch)/i.test(user_agent)) {
            return 'Kobo'
        } else if (/Nokia/i.test(user_agent)) {
            return 'Nokia'
        } else if (
            // Kindle Fire without Silk / Echo Show
            /(kf[a-z]{2}wi|aeo[c-r]{2})( bui|\))/i.test(user_agent) ||
            // Kindle Fire HD
            /(kf[a-z]+)( bui|\)).+silk\//i.test(user_agent)
        ) {
            return 'Kindle Fire'
        } else if (/(Android|ZTE)/i.test(user_agent)) {
            if (
                !/Mobile/.test(user_agent) ||
                /(9138B|TB782B|Nexus [97]|pixel c|HUAWEISHT|BTV|noble nook|smart ultra 6)/i.test(user_agent)
            ) {
                if (
                    (/pixel[\daxl ]{1,6}/i.test(user_agent) && !/pixel c/i.test(user_agent)) ||
                    /(huaweimed-al00|tah-|APA|SM-G92|i980|zte|U304AA)/i.test(user_agent) ||
                    (/lmy47v/i.test(user_agent) && !/QTAQZ3/i.test(user_agent))
                ) {
                    return ANDROID
                }
                return ANDROID_TABLET
            } else {
                return ANDROID
            }
        } else if (/(pda|mobile)/i.test(user_agent)) {
            return 'Generic mobile'
        } else if (/tablet/i.test(user_agent) && !/tablet pc/i.test(user_agent)) {
            return 'Generic tablet'
        } else {
            return ''
        }
    },

    // currently described as "the type of device that was used"
    deviceType: function (user_agent: string): string {
        const device = this.device(user_agent)
        if (
            device === IPAD ||
            device === ANDROID_TABLET ||
            device === 'Kobo' ||
            device === 'Kindle Fire' ||
            device === 'Generic tablet'
        ) {
            return 'Tablet'
        } else if (device === NINTENDO || device === XBOX || device === PLAYSTATION || device === 'Ouya') {
            return 'Console'
        } else if (device === APPLE_WATCH) {
            return 'Wearable'
        } else if (device) {
            return 'Mobile'
        } else {
            return 'Desktop'
        }
    },

    referrer: function (): string {
        return document?.referrer || '$direct'
    },

    referringDomain: function (): string {
        if (!document?.referrer) {
            return '$direct'
        }
        return convertToURL(document.referrer)?.host || '$direct'
    },

    properties: function (): Properties {
        if (!userAgent) {
            return {}
        }
        const { os_name, os_version } = _info.os(userAgent)
        return _extend(
            _strip_empty_properties({
                $os: os_name,
                $os_version: os_version,
                $browser: _info.browser(userAgent, navigator.vendor, assignableWindow.opera),
                $device: _info.device(userAgent),
                $device_type: _info.deviceType(userAgent),
            }),
            {
                $current_url: location?.href,
                $host: location?.host,
                $pathname: location?.pathname,
                $raw_user_agent: userAgent.length > 1000 ? userAgent.substring(0, 997) + '...' : userAgent,
                $browser_version: _info.browserVersion(userAgent, navigator.vendor, assignableWindow.opera),
                $browser_language: _info.browserLanguage(),
                $screen_height: window?.screen.height,
                $screen_width: window?.screen.width,
                $viewport_height: window?.innerHeight,
                $viewport_width: window?.innerWidth,
                $lib: 'web',
                $lib_version: Config.LIB_VERSION,
                $insert_id: Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10),
                $time: _timestamp() / 1000, // epoch time in seconds
            }
        )
    },

    people_properties: function (): Properties {
        if (!userAgent) {
            return {}
        }

        const { os_name, os_version } = _info.os(userAgent)
        return _extend(
            _strip_empty_properties({
                $os: os_name,
                $os_version: os_version,
                $browser: _info.browser(userAgent, navigator.vendor, assignableWindow.opera),
            }),
            {
                $browser_version: _info.browserVersion(userAgent, navigator.vendor, assignableWindow.opera),
            }
        )
    },
}
