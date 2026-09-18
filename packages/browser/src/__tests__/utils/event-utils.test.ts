import {
    getBrowserDetectionHints,
    getBrowserLanguage,
    getBrowserLanguagePrefix,
    getEventProperties,
    getTimezone,
    getTimezoneOffset,
} from '@posthog/browser-common/utils/event-utils'
import * as globals from '@posthog/browser-common/utils/globals'
import { isUndefined } from '@posthog/core'

describe(`event-utils`, () => {
    afterEach(() => vi.restoreAllMocks())

    describe('properties', () => {
        it('should have $host and $pathname in properties', () => {
            const properties = getEventProperties()
            expect(properties['$current_url']).toBeDefined()
            expect(properties['$host']).toBeDefined()
            expect(properties['$pathname']).toBeDefined()
        })

        it('should have user agent in properties', () => {
            vi.spyOn(globals, 'userAgent', 'get').mockReturnValue('blah')
            const properties = getEventProperties()
            expect(properties['$raw_user_agent']).toBe('blah')
        })

        it('should truncate very long user agents in properties', () => {
            vi.spyOn(globals, 'userAgent', 'get').mockReturnValue('a'.repeat(1001))
            const properties = getEventProperties()
            expect(properties['$raw_user_agent'].length).toBe(1000)
            expect(properties['$raw_user_agent'].substring(995)).toBe('aa...')
        })

        it('should mask out personal data from URL', () => {
            vi.spyOn(globals, 'location', 'get').mockReturnValue({
                href: 'https://www.example.com/path?gclid=12345&other=true',
            } as Location)
            const properties = getEventProperties(true)
            expect(properties['$current_url']).toEqual('https://www.example.com/path?gclid=<masked>&other=true')
        })

        it('should mask out custom personal data', () => {
            vi.spyOn(globals, 'location', 'get').mockReturnValue({
                href: 'https://www.example.com/path?gclid=12345&other=true',
            } as Location)
            const properties = getEventProperties(true, ['other'])
            expect(properties['$current_url']).toEqual('https://www.example.com/path?gclid=<masked>&other=<masked>')
        })

        it.each([
            ['by default', undefined, 'https://www.example.com/path?gclid=12345#section'],
            ['when disable_capture_url_hashes is false', false, 'https://www.example.com/path?gclid=12345#section'],
            ['when disable_capture_url_hashes is true', true, 'https://www.example.com/path?gclid=12345'],
        ])('should handle hash in current URL %s', (_description, disableCaptureUrlHashes, expectedUrl) => {
            vi.spyOn(globals, 'location', 'get').mockReturnValue({
                href: 'https://www.example.com/path?gclid=12345#section',
            } as Location)
            const properties = getEventProperties(false, undefined, undefined, disableCaptureUrlHashes)
            expect(properties['$current_url']).toEqual(expectedUrl)
        })

        it('should have timezone and timezone offset', () => {
            const properties = getEventProperties()
            expect(properties).toHaveProperty('$timezone')
            expect(properties).toHaveProperty('$timezone_offset')
        })
    })

    describe('webview app properties', () => {
        const androidUA =
            'Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36'

        const iosUA =
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

        it.each([
            [androidUA + ' LinkedInApp/2.295.106', 'LinkedIn', '2.295.106', undefined, 'Chrome', 120],
            [androidUA + ' [LinkedInApp]', 'LinkedIn', undefined, undefined, 'Chrome', 120],
            [androidUA + ' [FBAN/FB4A;FBAV/440.0.0;]', 'Facebook', '440.0.0', undefined, 'Chrome', 120],
            [iosUA + ' [FBIOS;FBAV/440.0.0;]', 'Facebook', '440.0.0', undefined, 'Facebook Mobile', null],
            [androidUA + ' GSA/315.0.1', 'Google', '315.0.1', false, 'Chrome', 120],
            [androidUA + ' GSA/315.0.1', 'Google', '315.0.1', true, 'Google Search App', 315],
            [androidUA + ' musical_ly_2022803040 app_version/28.3.4', 'TikTok', '28.3.4', undefined, 'Chrome', 120],
            [androidUA + ' musical_ly_2022803040', 'TikTok', undefined, undefined, 'Chrome', 120],
            [androidUA + ' WA4A/2.26.30.97', 'WhatsApp', '2.26.30.97', undefined, 'Chrome', 120],
            [androidUA + ' [FBAN/Orca-Android;FBAV/440.0.0;]', 'Messenger', '440.0.0', undefined, 'Chrome', 120],
        ])(
            'adds app properties for %s without changing browser attribution',
            (ua, app, version, gsa, browser, browserVersion) => {
                vi.spyOn(globals, 'userAgent', 'get').mockReturnValue(ua)
                const properties = getEventProperties(false, undefined, gsa)
                expect(properties['$webview_app']).toBe(app)
                if (version) {
                    expect(properties['$webview_app_version']).toBe(version)
                } else {
                    expect(properties).not.toHaveProperty('$webview_app_version')
                }
                expect(properties['$browser']).toBe(browser)
                expect(properties['$browser_version']).toBe(browserVersion)
            }
        )

        it.each([androidUA, androidUA.replace('; wv', ''), ''])('omits unknown app properties for %s', (ua) => {
            vi.spyOn(globals, 'userAgent', 'get').mockReturnValue(ua)
            const properties = getEventProperties()
            expect(properties).not.toHaveProperty('$webview_app')
            expect(properties).not.toHaveProperty('$webview_app_version')
        })
    })

    describe('tablet detection via supplementary signals', () => {
        const androidTabletDesktopUA =
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

        const originalUserAgentData = Object.getOwnPropertyDescriptor(window.navigator, 'userAgentData')
        const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(window.navigator, 'maxTouchPoints')
        const originalScreenWidth = Object.getOwnPropertyDescriptor(window.screen, 'width')
        const originalScreenHeight = Object.getOwnPropertyDescriptor(window.screen, 'height')
        const originalDevicePixelRatio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')

        function mockNavigator(userAgentData: any, maxTouchPoints: number) {
            Object.defineProperty(window.navigator, 'userAgentData', {
                value: userAgentData,
                configurable: true,
            })
            Object.defineProperty(window.navigator, 'maxTouchPoints', {
                value: maxTouchPoints,
                configurable: true,
            })
        }

        function mockScreen(width: number, height: number, devicePixelRatio?: number) {
            Object.defineProperty(window.screen, 'width', { value: width, configurable: true })
            Object.defineProperty(window.screen, 'height', { value: height, configurable: true })
            if (!isUndefined(devicePixelRatio)) {
                Object.defineProperty(window, 'devicePixelRatio', {
                    value: devicePixelRatio,
                    configurable: true,
                })
            }
        }

        beforeEach(() => {
            vi.spyOn(globals, 'userAgent', 'get').mockReturnValue(androidTabletDesktopUA)
        })

        afterEach(() => {
            if (originalUserAgentData) {
                Object.defineProperty(window.navigator, 'userAgentData', originalUserAgentData)
            } else {
                delete (window.navigator as any).userAgentData
            }
            if (originalMaxTouchPoints) {
                Object.defineProperty(window.navigator, 'maxTouchPoints', originalMaxTouchPoints)
            }
            if (originalScreenWidth) {
                Object.defineProperty(window.screen, 'width', originalScreenWidth)
            }
            if (originalScreenHeight) {
                Object.defineProperty(window.screen, 'height', originalScreenHeight)
            }
            if (originalDevicePixelRatio) {
                Object.defineProperty(window, 'devicePixelRatio', originalDevicePixelRatio)
            }
        })

        it('should detect Android tablet when UA reports desktop but Client Hints says Android', () => {
            mockNavigator({ platform: 'Android' }, 5)
            mockScreen(1280, 800)

            const properties = getEventProperties()
            expect(properties['$device_type']).toBe('Tablet')
        })

        it('should detect Android phone when screen short side is under 600px', () => {
            mockNavigator({ platform: 'Android' }, 5)
            mockScreen(412, 915)

            const properties = getEventProperties()
            expect(properties['$device_type']).toBe('Mobile')
        })

        it('should normalize screen size by devicePixelRatio for accurate dp classification', () => {
            mockNavigator({ platform: 'Android' }, 5)
            // 1200x800 physical pixels at 2x DPR = 600x400 dp, short side 400dp = phone
            mockScreen(1200, 800, 2)

            const properties = getEventProperties()
            expect(properties['$device_type']).toBe('Mobile')
        })

        it('should remain Desktop when Client Hints platform is not Android', () => {
            mockNavigator({ platform: 'Linux' }, 0)

            const properties = getEventProperties()
            expect(properties['$device_type']).toBe('Desktop')
        })

        it('should remain Desktop when maxTouchPoints is 0', () => {
            mockNavigator({ platform: 'Android' }, 0)

            const properties = getEventProperties()
            expect(properties['$device_type']).toBe('Desktop')
        })

        it('should remain Desktop when userAgentData is unavailable', () => {
            mockNavigator(undefined, 5)

            const properties = getEventProperties()
            expect(properties['$device_type']).toBe('Desktop')
        })
    })

    describe('getBrowserDetectionHints', () => {
        const originalBrave = Object.getOwnPropertyDescriptor(window.navigator, 'brave')

        afterEach(() => {
            if (originalBrave) {
                Object.defineProperty(window.navigator, 'brave', originalBrave)
            } else {
                delete (window.navigator as any).brave
            }
        })

        it('returns empty hints when navigator.brave is absent', () => {
            delete (window.navigator as any).brave
            expect(getBrowserDetectionHints()).toEqual({})
        })

        it('flags brave when navigator.brave exists', () => {
            Object.defineProperty(window.navigator, 'brave', {
                value: { isBrave: () => Promise.resolve(true) },
                configurable: true,
            })
            expect(getBrowserDetectionHints()).toEqual({ brave: true })
        })
    })

    describe('Brave detection end-to-end', () => {
        const chromeMacOsUA =
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        const originalBrave = Object.getOwnPropertyDescriptor(window.navigator, 'brave')

        beforeEach(() => {
            vi.spyOn(globals, 'userAgent', 'get').mockReturnValue(chromeMacOsUA)
        })

        afterEach(() => {
            if (originalBrave) {
                Object.defineProperty(window.navigator, 'brave', originalBrave)
            } else {
                delete (window.navigator as any).brave
            }
        })

        it('reports $browser as Brave when navigator.brave exists, even on a Chrome UA', () => {
            Object.defineProperty(window.navigator, 'brave', { value: {}, configurable: true })
            const properties = getEventProperties()
            expect(properties['$browser']).toBe('Brave')
            // Desktop Brave has no UA version marker, so honest null beats a
            // Chrome version stamped under `Brave`.
            expect(properties['$browser_version']).toBeNull()
        })

        it('reports $browser as Chrome when navigator.brave is absent', () => {
            delete (window.navigator as any).brave
            const properties = getEventProperties()
            expect(properties['$browser']).toBe('Chrome')
            expect(properties['$browser_version']).toBe(120.0)
        })
    })

    describe('timezones', () => {
        it('should compute timezone', () => {
            const timezone = getTimezone()
            expect(typeof timezone).toBe('string')
        })

        it('should compute timezone offset as a number', () => {
            const offset = getTimezoneOffset()
            expect(typeof offset).toBe('number')
        })
    })

    describe('browser language', () => {
        let languageGetter: vi.SpyInstance

        beforeEach(() => {
            languageGetter = vi.spyOn(window.navigator, 'language', 'get')
            languageGetter.mockReturnValue('pt-BR')
        })

        it('should compute browser language', () => {
            const language = getBrowserLanguage()
            expect(language).toBe('pt-BR')
        })

        it('should compute browser language prefix', () => {
            const languagePrefix = getBrowserLanguagePrefix()
            expect(languagePrefix).toBe('pt')
        })
    })
})
