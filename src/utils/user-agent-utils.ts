import { _includes } from './index'
import { _isUndefined } from './type-utils'

const FACEBOOK = 'Facebook'
const MOBILE = 'Mobile'
const IOS = 'iOS'
const ANDROID = 'Android'
const ANDROID_TABLET = ANDROID + ' Tablet'
const IPAD = 'iPad'
const APPLE = 'Apple'
const APPLE_WATCH = APPLE + ' Watch'
const SAFARI = 'Safari'
const BLACKBERRY = 'BlackBerry'
const SAMSUNG = 'Samsung'
const SAMSUNG_BROWSER = SAMSUNG + 'Browser'
const SAMSUNG_INTERNET = SAMSUNG + ' Internet'
const CHROME = 'Chrome'
const CHROME_OS = CHROME + ' OS'
const CHROME_IOS = CHROME + ' ' + IOS
const INTERNET_EXPLORER = 'Internet Explorer'
const INTERNET_EXPLORER_MOBILE = INTERNET_EXPLORER + ' ' + MOBILE
const OPERA = 'Opera'
const OPERA_MINI = OPERA + ' Mini'
const EDGE = 'Edge'
const MICROSOFT_EDGE = 'Microsoft ' + EDGE
const FIREFOX = 'Firefox'
const FIREFOX_IOS = FIREFOX + ' ' + IOS
const NINTENDO = 'Nintendo'
const PLAYSTATION = 'PlayStation'
const XBOX = 'Xbox'
const ANDROID_MOBILE = ANDROID + ' ' + MOBILE
const MOBILE_SAFARI = MOBILE + ' ' + SAFARI

const BROWSER_VERSION_REGEX_SUFFIX = '(\\d+(\\.\\d+)?)'
const DEFAULT_BROWSER_VERSION_REGEX = new RegExp('Version/' + BROWSER_VERSION_REGEX_SUFFIX)

const XBOX_REGEX = new RegExp(XBOX, 'i')
const PLAYSTATION_REGEX = new RegExp(PLAYSTATION + ' \\w+', 'i')
const NINTENDO_REGEX = new RegExp(NINTENDO + ' \\w+', 'i')
const BLACKBERRY_REGEX = new RegExp(BLACKBERRY + '|PlayBook|BB10', 'i')

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

/**
 * This function detects which browser is running this script.
 * The order of the checks are important since many user agents
 * include keywords used in later checks.
 */
export const detectBrowser = function (user_agent: string, vendor: string | undefined, opera?: any): string {
    vendor = vendor || '' // vendor is undefined for at least IE9
    if (opera || _includes(user_agent, ' OPR/')) {
        if (_includes(user_agent, 'Mini')) {
            return OPERA_MINI
        }
        return OPERA
    } else {
        if (BLACKBERRY_REGEX.test(user_agent)) {
            return BLACKBERRY
        } else if (_includes(user_agent, 'IE' + MOBILE) || _includes(user_agent, 'WPDesktop')) {
            return INTERNET_EXPLORER_MOBILE
        } else if (_includes(user_agent, `${SAMSUNG_BROWSER}/`)) {
            // https://developer.samsung.com/internet/user-agent-string-format
            return SAMSUNG_INTERNET
        } else if (_includes(user_agent, EDGE) || _includes(user_agent, 'Edg/')) {
            return MICROSOFT_EDGE
        } else if (_includes(user_agent, 'FBIOS')) {
            return FACEBOOK + ' ' + MOBILE
        } else if (_includes(user_agent, CHROME)) {
            return CHROME
        } else if (_includes(user_agent, 'CriOS')) {
            return CHROME_IOS
        } else if (_includes(user_agent, 'UCWEB') || _includes(user_agent, 'UCBrowser')) {
            return 'UC Browser'
        } else if (_includes(user_agent, 'FxiOS')) {
            return FIREFOX_IOS
        } else if (_includes(vendor, APPLE) || isSafari(user_agent)) {
            if (_includes(user_agent, MOBILE)) {
                return MOBILE_SAFARI
            }
            return SAFARI
        } else if (_includes(user_agent, ANDROID)) {
            return ANDROID_MOBILE
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
}

/**
 * This function detects which browser version is running this script,
 * parsing major and minor version (e.g., 42.1). User agent strings from:
 * http://www.useragentstring.com/pages/useragentstring.php
 *
 * `navigator.vendor` is passed in and used to help with detecting certain browsers
 * NB `navigator.vendor` is deprecated and not present in every browser
 */
export const detectBrowserVersion = function (
    userAgent: string,
    vendor: string | undefined,
    opera: string
): number | null {
    const browser = detectBrowser(userAgent, vendor, opera)
    const versionRegexes: Record<string, RegExp[]> = {
        [INTERNET_EXPLORER_MOBILE]: [new RegExp(`rv:${BROWSER_VERSION_REGEX_SUFFIX}`)],
        [MICROSOFT_EDGE]: [new RegExp(`${EDGE}?\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
        [CHROME]: [new RegExp(`${CHROME}/${BROWSER_VERSION_REGEX_SUFFIX}`)],
        [CHROME_IOS]: [new RegExp(`CriOS\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
        'UC Browser': [new RegExp(`(UCBrowser|UCWEB)\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
        [SAFARI]: [DEFAULT_BROWSER_VERSION_REGEX],
        [MOBILE_SAFARI]: [DEFAULT_BROWSER_VERSION_REGEX],
        [OPERA]: [new RegExp(`(${OPERA}|OPR)\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
        [FIREFOX]: [new RegExp(`${FIREFOX}\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
        [FIREFOX_IOS]: [new RegExp(`FxiOS\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
        Konqueror: [new RegExp(`Konqueror[:/]?${BROWSER_VERSION_REGEX_SUFFIX}`, 'i')],
        // not every blackberry user agent has the version after the name
        [BLACKBERRY]: [new RegExp(`${BLACKBERRY} ${BROWSER_VERSION_REGEX_SUFFIX}`), DEFAULT_BROWSER_VERSION_REGEX],
        [ANDROID_MOBILE]: [new RegExp(`android\\s${BROWSER_VERSION_REGEX_SUFFIX}`)],
        [SAMSUNG_INTERNET]: [new RegExp(`${SAMSUNG_BROWSER}\\/${BROWSER_VERSION_REGEX_SUFFIX}`)],
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
}

export const detectOS = function (user_agent: string): [string, string] {
    // to avoid repeating regexes or calling them twice, we have an array of matches
    // the first regex that matches uses its matcher function to return the result
    const osMatchers: [RegExp, (match: RegExpMatchArray | null) => [string, string]][] = [
        [
            /xbox; xbox (.*?)[);]/i,
            (match) => {
                return [XBOX, (match && match[1]) || '']
            },
        ],
        [
            /nintendo/i,
            () => {
                return [NINTENDO, '']
            },
        ],
        [
            /playstation/i,
            () => {
                return [PLAYSTATION, '']
            },
        ],
        [
            BLACKBERRY_REGEX,
            () => {
                return [BLACKBERRY, '']
            },
        ],
        [
            /Windows/i,
            () => {
                if (/Phone/.test(user_agent) || /WPDesktop/.test(user_agent)) {
                    return ['Windows Phone', '']
                }
                // not all JS versions support negative lookbehind, so we need two checks here
                if (/Mobile\b/.test(user_agent) && !/IEMobile\b/.test(user_agent)) {
                    return ['Windows ' + MOBILE, '']
                }
                const match = /Windows NT ([0-9.]+)/i.exec(user_agent)
                if (match && match[1]) {
                    const version = match[1]
                    let osVersion = windowsVersionMap[version] || ''
                    if (/arm/i.test(user_agent)) {
                        osVersion = 'RT'
                    }
                    return ['Windows', osVersion]
                }
                return ['Windows', '']
            },
        ],
        [
            /((iPhone|iPad|iPod).*?OS (\d+)_(\d+)_?(\d+)?|iPhone)/,
            (match) => {
                if (match && match[3]) {
                    const versionParts = [match[3], match[4], match[5] || '0']
                    return [IOS, versionParts.join('.')]
                }
                return [IOS, '']
            },
        ],
        [
            /(watch.*\/(\d+\.\d+\.\d+)|watch os,(\d+\.\d+),)/i,
            (match) => {
                // e.g. Watch4,3/5.3.8 (16U680)
                let version = ''
                if (match && match.length >= 3) {
                    version = _isUndefined(match[2]) ? match[3] : match[2]
                }
                return ['watchOS', version]
            },
        ],
        [
            /(Android (\d+)\.(\d+)\.?(\d+)?|Android)/i,
            (match) => {
                if (match && match[2]) {
                    const versionParts = [match[2], match[3], match[4] || '0']
                    return [ANDROID, versionParts.join('.')]
                }
                return [ANDROID, '']
            },
        ],
        [
            /Mac OS X (\d+)[_.](\d+)[_.]?(\d+)?/i,
            (match) => {
                const result: [string, string] = ['Mac OS X', '']
                if (match && match[1]) {
                    const versionParts = [match[1], match[2], match[3] || '0']
                    result[1] = versionParts.join('.')
                }
                return result
            },
        ],
        [
            /Mac/i,
            () => {
                // mop up a few non-standard UAs that should match mac
                return ['Mac OS X', '']
            },
        ],
        [
            /CrOS/,
            () => {
                return [CHROME_OS, '']
            },
        ],
        [
            /Linux|debian/i,
            () => {
                return ['Linux', '']
            },
        ],
    ]
    for (let i = 0; i < osMatchers.length; i++) {
        const [rgex, matcherFn] = osMatchers[i]
        const match = rgex.exec(user_agent)
        const result = match && matcherFn(match)
        if (result) {
            return result
        }
    }
    return ['', '']
}

export const detectDevice = function (user_agent: string): string {
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
    } else if (BLACKBERRY_REGEX.test(user_agent)) {
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
}

export const detectDeviceType = function (user_agent: string): string {
    const device = detectDevice(user_agent)
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
}
