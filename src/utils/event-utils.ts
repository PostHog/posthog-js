import { _getQueryParam, convertToURL } from './request-utils'
import { _isNull, _isUndefined } from './type-utils'
import { Properties } from '../types'
import Config from '../config'
import { _each, _extend, _includes, _strip_empty_properties, _timestamp } from './index'
import { document, window, location, userAgent, assignableWindow } from './globals'

const ANDROID = 'Android'
const IPAD = 'iPad'
const SAFARI = 'Safari'
const BLACKBERRY = 'BlackBerry'
const CHROME = 'Chrome'

/**
 * Safari detection turns out to be complicted. For e.g. https://stackoverflow.com/a/29696509
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
        } else if (referrer.search('https?://(.*)google.([^/?]*)') === 0) {
            return 'google'
        } else if (referrer.search('https?://(.*)bing.com') === 0) {
            return 'bing'
        } else if (referrer.search('https?://(.*)yahoo.com') === 0) {
            return 'yahoo'
        } else if (referrer.search('https?://(.*)duckduckgo.com') === 0) {
            return 'duckduckgo'
        } else {
            return null
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
        } else if (/(BlackBerry|PlayBook|BB10)/i.test(user_agent)) {
            return BLACKBERRY
        } else if (_includes(user_agent, 'IEMobile') || _includes(user_agent, 'WPDesktop')) {
            return 'Internet Explorer Mobile'
        } else if (_includes(user_agent, 'SamsungBrowser/')) {
            // https://developer.samsung.com/internet/user-agent-string-format
            return 'Samsung Internet'
        } else if (_includes(user_agent, 'Edge') || _includes(user_agent, 'Edg/')) {
            return 'Microsoft Edge'
        } else if (_includes(user_agent, 'FBIOS')) {
            return 'Facebook Mobile'
        } else if (_includes(user_agent, CHROME)) {
            return CHROME
        } else if (_includes(user_agent, 'CriOS')) {
            return 'Chrome iOS'
        } else if (_includes(user_agent, 'UCWEB') || _includes(user_agent, 'UCBrowser')) {
            return 'UC Browser'
        } else if (_includes(user_agent, 'FxiOS')) {
            return 'Firefox iOS'
        } else if (_includes(vendor, 'Apple') || isSafari(user_agent)) {
            if (_includes(user_agent, 'Mobile')) {
                return 'Mobile Safari'
            }
            return SAFARI
        } else if (_includes(user_agent, ANDROID)) {
            return 'Android Mobile'
        } else if (_includes(user_agent, 'Konqueror') || _includes(user_agent, 'konqueror')) {
            return 'Konqueror'
        } else if (_includes(user_agent, 'Firefox')) {
            return 'Firefox'
        } else if (_includes(user_agent, 'MSIE') || _includes(user_agent, 'Trident/')) {
            return 'Internet Explorer'
        } else if (_includes(user_agent, 'Gecko')) {
            return 'Mozilla'
        } else {
            return ''
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
            'Internet Explorer Mobile': [/rv:(\d+(\.\d+)?)/],
            'Microsoft Edge': [/Edge?\/(\d+(\.\d+)?)/],
            Chrome: [/Chrome\/(\d+(\.\d+)?)/],
            'Chrome iOS': [/CriOS\/(\d+(\.\d+)?)/],
            'UC Browser': [/(UCBrowser|UCWEB)\/(\d+(\.\d+)?)/],
            Safari: [/Version\/(\d+(\.\d+)?)/],
            'Mobile Safari': [/Version\/(\d+(\.\d+)?)/],
            Opera: [/(Opera|OPR)\/(\d+(\.\d+)?)/],
            Firefox: [/Firefox\/(\d+(\.\d+)?)/],
            'Firefox iOS': [/FxiOS\/(\d+(\.\d+)?)/],
            Konqueror: [/Konqueror[:/]?(\d+(\.\d+)?)/i],
            // not every blackberry user agent has the version after the name
            BlackBerry: [/BlackBerry (\d+(\.\d+)?)/, /Version\/(\d+(\.\d+)?)/],
            'Android Mobile': [/android\s(\d+(\.\d+)?)/],
            'Samsung Internet': [/SamsungBrowser\/(\d+(\.\d+)?)/],
            'Internet Explorer': [/(rv:|MSIE )(\d+(\.\d+)?)/],
            Mozilla: [/rv:(\d+(\.\d+)?)/],
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
        if (/Windows/i.test(user_agent)) {
            if (/Phone/.test(user_agent) || /WPDesktop/.test(user_agent)) {
                return { os_name: 'Windows Phone', os_version: '' }
            }
            const match = /Windows NT ([0-9.]+)/i.exec(user_agent)
            if (match && match[1]) {
                const version = match[1]
                return { os_name: 'Windows', os_version: version }
            }
            return { os_name: 'Windows', os_version: '' }
        } else if (/(iPhone|iPad|iPod)/.test(user_agent)) {
            const match = /OS (\d+)_(\d+)_?(\d+)?/i.exec(user_agent)
            if (match && match[1]) {
                const versionParts = [match[1], match[2], match[3] || '0']
                return { os_name: 'iOS', os_version: versionParts.join('.') }
            }
            return { os_name: 'iOS', os_version: '' }
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
        } else if (/Linux/.test(user_agent)) {
            return { os_name: 'Linux', os_version: '' }
        } else if (/CrOS/.test(user_agent)) {
            return { os_name: 'Chrome OS', os_version: '' }
        } else {
            return { os_name: '', os_version: '' }
        }
    },

    device: function (user_agent: string): string {
        if (/(Nintendo \w+)/i.test(user_agent) || /(playstation \w+)/i.test(user_agent)) {
            return 'Nintendo'
        } else if (/Windows Phone/i.test(user_agent) || /WPDesktop/.test(user_agent)) {
            return 'Windows Phone'
        } else if (/iPad/.test(user_agent)) {
            return IPAD
        } else if (/iPod/.test(user_agent)) {
            return 'iPod Touch'
        } else if (/iPhone/.test(user_agent)) {
            return 'iPhone'
        } else if (/(watch)(?: ?os[,/]|\d,\d\/)[\d.]+/i.test(user_agent)) {
            return 'Apple Watch'
        } else if (/(BlackBerry|PlayBook|BB10)/i.test(user_agent)) {
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
        } else if (/Android/.test(user_agent)) {
            if (!/Mobile/.test(user_agent) || /Nexus 9/.test(user_agent) || /(HUAWEISHT|BTV)/i.test(user_agent)) {
                if (/(huaweimed-al00|tah-|APA)/i.test(user_agent)) {
                    return ANDROID
                }
                return 'Android Tablet'
            } else {
                return ANDROID
            }
        } else {
            return ''
        }
    },

    deviceType: function (user_agent: string): string {
        const device = this.device(user_agent)
        if (device === IPAD || device === 'Android Tablet' || device === 'Kobo' || device === 'Kindle Fire') {
            return 'Tablet'
        } else if (device === 'Nintendo') {
            return 'Console'
        } else if (device === 'Apple Watch') {
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
