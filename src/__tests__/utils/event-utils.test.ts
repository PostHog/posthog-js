import { _info } from '../../utils/event-utils'
import * as globals from '../../utils/globals'
import uaParserDeviceTestCases from './device.test.json'
import uaParserOSTestCases from './os-test.json'
import { _isUndefined } from '../../utils/type-utils'

describe(`event-utils`, () => {
    describe('properties', () => {
        it('should have $host and $pathname in properties', () => {
            const properties = _info.properties()
            expect(properties['$current_url']).toBeDefined()
            expect(properties['$host']).toBeDefined()
            expect(properties['$pathname']).toBeDefined()
        })

        it('should have user agent in properties', () => {
            // TS doesn't like it but we can assign userAgent
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            globals['userAgent'] = 'blah'
            const properties = _info.properties()
            expect(properties['$raw_user_agent']).toBe('blah')
        })

        it('should truncate very long user agents in properties', () => {
            // TS doesn't like it but we can assign userAgent
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            globals['userAgent'] = 'a'.repeat(1001)
            const properties = _info.properties()
            expect(properties['$raw_user_agent'].length).toBe(1000)
            expect(properties['$raw_user_agent'].substring(995)).toBe('aa...')
        })
    })

    describe('user agent', () => {
        // can use https://user-agents.net/ or $raw_user_agent property on events to get new test cases
        const browserTestcases: {
            name: string
            userAgent: string
            vendor: string
            expectedVersion: number | null
            expectedBrowser: string
        }[] = [
            {
                name: 'Chrome 91',
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                vendor: '',
                expectedVersion: 91.0,
                expectedBrowser: 'Chrome',
            },
            {
                name: 'Firefox 89',
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
                vendor: '',
                expectedVersion: 89.0,
                expectedBrowser: 'Firefox',
            },
            {
                name: 'unknown browser',
                userAgent: 'UnknownBrowser/5.0',
                vendor: '',
                expectedVersion: null,
                expectedBrowser: '',
            },
            {
                name: 'invalid chrome',
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36',
                vendor: '',
                expectedVersion: null,
                expectedBrowser: 'Chrome',
            },
            {
                name: 'Internet Explorer Mobile',
                userAgent:
                    'Mozilla/5.0 (Windows Phone 8.1; ARM; Trident/7.0; Touch; rv:11.0; IEMobile/11.0; NOKIA; 909) like Gecko',
                vendor: '',
                expectedVersion: 11.0,
                expectedBrowser: 'Internet Explorer Mobile',
            },
            {
                name: 'Microsoft Edge 44',
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/44.17763.831.0',
                vendor: '',
                expectedVersion: 44.17763,
                expectedBrowser: 'Microsoft Edge',
            },
            {
                name: 'Chrome 21 iOS',
                userAgent:
                    'Mozilla/5.0 (iPhone; U; CPU iPhone OS 5_1_1 like Mac OS X; en) AppleWebKit/534.46.0 (KHTML, like Gecko) CriOS/21.0.1180.82 Mobile/9B206 Safari/7534.48.3',
                vendor: '',
                expectedVersion: 21.0,
                expectedBrowser: 'Chrome iOS',
            },
            {
                name: 'UC Browser',
                userAgent:
                    'Mozilla/5.0 (Linux; U; Android 4.2.2; en-US; Micromax A116 Build/JDQ39) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 UCBrowser/10.7.5.658 U3/0.8.0 Mobile Safari/534.30',
                vendor: '',
                expectedVersion: 10.7,
                expectedBrowser: 'UC Browser',
            },
            {
                name: 'Safari',
                userAgent:
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
                vendor: 'Apple',
                expectedVersion: 17.1,
                expectedBrowser: 'Safari',
            },
            {
                name: 'Opera',
                userAgent:
                    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.69 Safari/537.36 OPR/34.0.2036.25',
                vendor: '',
                expectedVersion: 34.0,
                expectedBrowser: 'Opera',
            },
            {
                name: 'Firefox iOS',
                userAgent:
                    'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3 like Mac OS X) AppleWebKit/602.1.50 (KHTML, like Gecko) FxiOS/8.3b5826 Mobile/14E5239e Safari/602.1.50',
                vendor: '',
                expectedVersion: 8.3,
                expectedBrowser: 'Firefox iOS',
            },
            {
                name: 'Konqueror (lowercase)',
                userAgent: 'Mozilla/5.0 (X11; U; U; DragonFly amd64) KIO/5.97 konqueror/22.08.0',
                vendor: '',
                expectedVersion: 22.08,
                expectedBrowser: 'Konqueror',
            },
            {
                name: 'Konqueror (uppercase)',
                userAgent: 'Mozilla/5.0 (X11; Linux i686) KHTML/5.20 (like Gecko) Konqueror/5.20',
                vendor: '',
                expectedVersion: 5.2,
                expectedBrowser: 'Konqueror',
            },
            {
                name: 'BlackBerry Bold 9790',
                userAgent:
                    'Mozilla/5.0 (BlackBerry; U; BlackBerry 9790; es) AppleWebKit/534.11+ (KHTML, like Gecko) Version/7.1.0.569 Mobile Safari/534.11+',
                vendor: '',
                // TODO should we match 9790 the model and not 7.1 the browser version?
                expectedVersion: 9790,
                expectedBrowser: 'BlackBerry',
            },
            {
                name: 'BlackBerry BB10 version v10.1',
                userAgent:
                    'Mozilla/5.0 (BB10; Kbd) AppleWebKit/537.10+ (KHTML, like Gecko) Version/10.1.0.1720 Mobile Safari/537.10+',
                vendor: '',
                expectedVersion: 10.1,
                expectedBrowser: 'BlackBerry',
            },
            {
                name: 'Android Mobile',
                userAgent:
                    'Mozilla/5.0 (Linux; StarOS Must use __system_property_read_callback() to read; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.127 Mobile Safari/537.36',
                vendor: '',
                // TODO should we detect this as Chrome or Android Mobile?
                expectedVersion: 100,
                expectedBrowser: 'Chrome',
            },
            {
                name: 'Samsung Internet',
                userAgent:
                    'Mozilla/5.0 (Linux; Android 5.0.2; SAMSUNG SM-T550 Build/LRX22G) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/3.5 Chrome/38.0.2125.102 Safari/537.36',
                vendor: '',
                expectedVersion: 3.5,
                expectedBrowser: 'Samsung Internet',
            },
            {
                name: 'Internet Explorer',
                userAgent: 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; Trident/6.0)',
                vendor: '',
                expectedVersion: 10.0,
                expectedBrowser: 'Internet Explorer',
            },
            {
                name: 'mobile safari (with vendor)',
                userAgent:
                    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                vendor: 'Apple',
                expectedVersion: 16.6,
                expectedBrowser: 'Mobile Safari',
            },
            {
                name: 'mobile safari (without vendor)',
                userAgent:
                    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                vendor: '', // vendor is deprecated, and we see this user agent not matching in the wild
                expectedVersion: 16.6,
                expectedBrowser: 'Mobile Safari',
            },
            {
                name: 'firefox for ios',
                userAgent:
                    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/106.0 Mobile/15E148 Safari/605.1.15',
                vendor: '',
                expectedVersion: 106.0,
                expectedBrowser: 'Firefox iOS',
            },
        ]

        test.each(browserTestcases)('browser version %s', ({ userAgent, vendor, expectedVersion }) => {
            expect(_info.browserVersion(userAgent, vendor, '')).toBe(expectedVersion)
        })

        test.each(browserTestcases)('browser %s', ({ userAgent, vendor, expectedBrowser }) => {
            expect(_info.browser(userAgent, vendor, '')).toBe(expectedBrowser)
        })

        /**
         * ua-parser-js v1 has MIT licensed test cases
         * at "https://github.com/faisalman/ua-parser-js#8087a1b4f0e25f1663ca3ddc2e06371d36642173"
         * they were copied here
         */
        test.each(uaParserDeviceTestCases)('device - $ua', (testCase) => {
            if (testCase['expect']['type'] === 'smarttv') {
                // we'll test that separately
                return
            }
            if (testCase['expect']['type'] === 'wearable') {
                // we'll test that separately
                return
            }
            if (testCase['expect']['type'] === 'embedded') {
                // we don't support it
                return
            }
            const actual = _info.deviceType(testCase['ua']).toLowerCase()
            const expected =
                _isUndefined(testCase['expect']['type']) || testCase['expect']['type'] === 'undefined'
                    ? 'desktop'
                    : testCase['expect']['type']
            expect(actual).toBe(expected)
        })

        /**
         * ua-parser-js v1 has MIT licensed test cases
         * at "https://github.com/faisalman/ua-parser-js#8087a1b4f0e25f1663ca3ddc2e06371d36642173"
         * they were copied here
         *
         * we had to edit them a chunk because we don't aim for the same level of detail
         */
        test.each(uaParserOSTestCases)('OS - $ua', (testCase) => {
            const actual = _info.os(testCase['ua'])
            const expected = testCase['expect']
            expect(actual).toStrictEqual(expected)
        })
    })
})
