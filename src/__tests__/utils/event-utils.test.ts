import { Info } from '../../utils/event-utils'
import * as globals from '../../utils/globals'
import uaParserDeviceTestCases from './device.test.json'
import uaParserOSTestCases from './os-test.json'
import { isUndefined } from '../../utils/type-utils'
import { detectBrowser } from '../../utils/user-agent-utils'

describe(`event-utils`, () => {
    describe('properties', () => {
        it('should have $host and $pathname in properties', () => {
            const properties = Info.properties()
            expect(properties['$current_url']).toBeDefined()
            expect(properties['$host']).toBeDefined()
            expect(properties['$pathname']).toBeDefined()
        })

        it('should have user agent in properties', () => {
            // TS doesn't like it but we can assign userAgent
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            globals['userAgent'] = 'blah'
            const properties = Info.properties()
            expect(properties['$raw_user_agent']).toBe('blah')
        })

        it('should truncate very long user agents in properties', () => {
            // TS doesn't like it but we can assign userAgent
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            globals['userAgent'] = 'a'.repeat(1001)
            const properties = Info.properties()
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
            expect(Info.browserVersion(userAgent, vendor, '')).toBe(expectedVersion)
        })

        test.each(browserTestcases)('browser %s', ({ userAgent, vendor, expectedBrowser }) => {
            expect(Info.browser(userAgent, vendor, '')).toBe(expectedBrowser)
        })

        /**
         * ua-parser-js v1 has MIT licensed test cases
         * at "https://github.com/faisalman/ua-parser-js#8087a1b4f0e25f1663ca3ddc2e06371d36642173"
         * they were copied here
         */
        test.each(uaParserDeviceTestCases.filter((tc) => !tc['//']))('device - $ua', (testCase) => {
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
            const actual = Info.deviceType(testCase['ua']).toLowerCase()
            const expected =
                isUndefined(testCase['expect']['type']) || testCase['expect']['type'] === 'undefined'
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
        test.each(uaParserOSTestCases.filter((tc) => !tc['//']))('OS - $ua', (testCase) => {
            const result = Info.os(testCase['ua'])
            const expected = testCase['expect']
            expect(result).toStrictEqual([expected.os_name, expected.os_version])
        })

        test('can rely on vendor string to detect safari', () => {
            const ua = 'Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/16.7.0'
            const vendor = 'Apple Computer, Inc.'
            expect(detectBrowser(ua, vendor, '')).toBe('Safari')
        })

        test('osVersion', () => {
            const osVersions = {
                // Windows Phone
                'Mozilla/5.0 (Mobile; Windows Phone 8.1; Android 4.0; ARM; Trident/7.0; Touch; rv:11.0; IEMobile/11.0; NOKIA; Lumia 635; BOOST) like iPhone OS 7_0_3 Mac OS X AppleWebKit/537 (KHTML, like Gecko) Mobile Safari/537':
                    { os_name: 'Windows Phone', os_version: '' },
                'Mozilla/5.0 (Windows NT 6.3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.122 Safari/537.36':
                    {
                        os_name: 'Windows',
                        os_version: '8.1',
                    },
                'Mozilla/5.0 (iPhone; CPU iPhone OS 8_2 like Mac OS X) AppleWebKit/600.1.4 (KHTML, like Gecko) CriOS/44.0.2403.67 Mobile/12D508 Safari/600.1.4':
                    {
                        os_name: 'iOS',
                        os_version: '8.2.0',
                    },
                'Mozilla/5.0 (iPad; CPU OS 8_4 like Mac OS X) AppleWebKit/600.1.4 (KHTML, like Gecko) Version/8.0 Mobile/12H143 Safari/600.1.4':
                    {
                        os_name: 'iOS',
                        os_version: '8.4.0',
                    },
                'Mozilla/5.0 (Linux; Android 4.4.2; Lenovo A7600-F Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.133 Safari/537.36':
                    {
                        os_name: 'Android',
                        os_version: '4.4.2',
                    },
                'Mozilla/5.0 (BlackBerry; U; BlackBerry 9300; es) AppleWebKit/534.8+ (KHTML, like Gecko) Version/6.0.0.480 Mobile Safari/534.8+':
                    {
                        os_name: 'BlackBerry',
                        os_version: '',
                    },
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.130 Safari/537.36':
                    {
                        os_name: 'Mac OS X',
                        os_version: '10.9.5',
                    },
                'Opera/9.80 (Linux armv7l; InettvBrowser/2.2 (00014A;SonyDTV140;0001;0001) KDL40W600B; CC/MEX) Presto/2.12.407 Version/12.50':
                    {
                        os_name: 'Linux',
                        os_version: '',
                    },
                'Mozilla/5.0 (X11; CrOS armv7l 6680.81.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.118 Safari/537.36':
                    {
                        os_name: 'Chrome OS',
                        os_version: '',
                    },
            }

            for (const [userAgent, osInfo] of Object.entries(osVersions)) {
                const [os_name, os_version] = Info.os(userAgent)
                expect(os_name).toBe(osInfo.os_name)
                expect(os_version).toBe(osInfo.os_version)
            }
        })
    })
})
