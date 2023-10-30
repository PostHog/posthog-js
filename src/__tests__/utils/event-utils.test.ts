import { _info } from '../../utils/event-utils'
import * as globals from '../../utils/globals'

jest.mock('../../utils/globals')

describe(`event-utils`, () => {
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
            name: 'should return correct version for Microsoft Edge',
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/44.17763.831.0',
            vendor: '',
            expectedVersion: 44.17763,
            expectedBrowser: 'Microsoft Edge',
        },

        {
            name: 'should return correct version for Chrome iOS',
            userAgent:
                'Mozilla/5.0 (iPhone; U; CPU iPhone OS 5_1_1 like Mac OS X; en) AppleWebKit/534.46.0 (KHTML, like Gecko) CriOS/21.0.1180.82 Mobile/9B206 Safari/7534.48.3',
            vendor: '',
            expectedVersion: 21.0,
            expectedBrowser: 'Chrome iOS',
        },

        {
            name: 'should return correct UC Browser version',
            userAgent:
                'Mozilla/5.0 (Linux; U; Android 4.2.2; en-US; Micromax A116 Build/JDQ39) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 UCBrowser/10.7.5.658 U3/0.8.0 Mobile Safari/534.30',
            vendor: '',
            expectedVersion: 10.7,
            expectedBrowser: 'UC Browser',
        },

        {
            name: 'should return correct Safari version',
            userAgent:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            vendor: 'Apple',
            expectedVersion: 17.1,
            expectedBrowser: 'Safari',
        },

        {
            name: 'should return correct Opera version',
            userAgent:
                'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.69 Safari/537.36 OPR/34.0.2036.25',
            vendor: '',
            expectedVersion: 34.0,
            expectedBrowser: 'Opera',
        },

        {
            name: 'should return correct Firefox iOS version',
            userAgent:
                'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3 like Mac OS X) AppleWebKit/602.1.50 (KHTML, like Gecko) FxiOS/8.3b5826 Mobile/14E5239e Safari/602.1.50',
            vendor: '',
            expectedVersion: 8.3,
            expectedBrowser: 'Firefox iOS',
        },

        {
            name: 'should return correct Konqueror version',
            userAgent: 'Mozilla/5.0 (X11; U; U; DragonFly amd64) KIO/5.97 konqueror/22.08.0',
            vendor: '',
            expectedVersion: 22.08,
            expectedBrowser: 'Konqueror',
        },

        {
            name: 'should return 7.1 for BlackBerry Bold 9790 version',
            userAgent:
                'Mozilla/5.0 (BlackBerry; U; BlackBerry 9790; es) AppleWebKit/534.11+ (KHTML, like Gecko) Version/7.1.0.569 Mobile Safari/534.11+',
            vendor: '',
            // TODO is this a bug we match 9790 the model and not 7.1 the browser version
            expectedVersion: 9790,
            expectedBrowser: 'BlackBerry',
        },

        {
            name: 'should return 10.1 for BlackBerry BB10 version',
            userAgent:
                'Mozilla/5.0 (BB10; Kbd) AppleWebKit/537.10+ (KHTML, like Gecko) Version/10.1.0.1720 Mobile Safari/537.10+',
            vendor: '',
            expectedVersion: 10.1,
            expectedBrowser: 'BlackBerry',
        },

        {
            name: 'should return correct Android Mobile version',
            userAgent:
                'Mozilla/5.0 (Linux; StarOS Must use __system_property_read_callback() to read; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.127 Mobile Safari/537.36',
            vendor: '',
            expectedVersion: 4.0,
            expectedBrowser: 'Android Mobile',
        },

        {
            name: 'should return correct Samsung Internet version',
            userAgent:
                'Mozilla/5.0 (Linux; Android 5.0.2; SAMSUNG SM-T550 Build/LRX22G) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/3.5 Chrome/38.0.2125.102 Safari/537.36',
            vendor: '',
            expectedVersion: 3.5,
            expectedBrowser: 'Samsung Internet',
        },
        {
            name: 'should return correct Internet Explorer version',
            userAgent: 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; Trident/6.0)',
            vendor: '',
            expectedVersion: 10.0,
            expectedBrowser: 'Internet Explorer',
        },
    ]

    test.each(browserTestcases)('browser version %s', ({ userAgent, vendor, expectedVersion }) => {
        expect(_info.browserVersion(userAgent, vendor, '')).toBe(expectedVersion)
    })

    test.each(browserTestcases)('browser %s', ({ userAgent, vendor, expectedBrowser }) => {
        expect(_info.browser(userAgent, vendor, '')).toBe(expectedBrowser)
    })
})
