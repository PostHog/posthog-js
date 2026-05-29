import {
    getBrowserDetectionHints,
    getBrowserLanguage,
    getBrowserLanguagePrefix,
    getEventProperties,
    getTimezone,
    getTimezoneOffset,
} from '../../utils/event-utils'
import * as globals from '../../utils/globals'
import { isUndefined } from '@posthog/core'

describe(`event-utils`, () => {
    describe('properties', () => {
        it('should have $host and $pathname in properties', () => {
            const properties = getEventProperties()
            expect(properties['$current_url']).toBeDefined()
            expect(properties['$host']).toBeDefined()
            expect(properties['$pathname']).toBeDefined()
        })

        it('should have user agent in properties', () => {
            // TS doesn't like it but we can assign userAgent
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            globals['userAgent'] = 'blah'
            const properties = getEventProperties()
            expect(properties['$raw_user_agent']).toBe('blah')
        })

        it('should truncate very long user agents in properties', () => {
            // TS doesn't like it but we can assign userAgent
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            globals['userAgent'] = 'a'.repeat(1001)
            const properties = getEventProperties()
            expect(properties['$raw_user_agent'].length).toBe(1000)
            expect(properties['$raw_user_agent'].substring(995)).toBe('aa...')
        })

        it('should mask out personal data from URL', () => {
            // @ts-expect-error ok to set global in test
            globals.location = { href: 'https://www.example.com/path?gclid=12345&other=true' }
            const properties = getEventProperties(true)
            expect(properties['$current_url']).toEqual('https://www.example.com/path?gclid=<masked>&other=true')
        })

        it('should mask out custom personal data', () => {
            // @ts-expect-error ok to set global in test
            globals.location = { href: 'https://www.example.com/path?gclid=12345&other=true' }
            const properties = getEventProperties(true, ['other'])
            expect(properties['$current_url']).toEqual('https://www.example.com/path?gclid=<masked>&other=<masked>')
        })

        it('should have timezone and timezone offset', () => {
            const properties = getEventProperties()
            expect(properties).toHaveProperty('$timezone')
            expect(properties).toHaveProperty('$timezone_offset')
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
            // @ts-expect-error ok to set global in test
            globals['userAgent'] = androidTabletDesktopUA
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
        const originalUserAgentData = Object.getOwnPropertyDescriptor(window.navigator, 'userAgentData')
        const originalBrave = Object.getOwnPropertyDescriptor(window.navigator, 'brave')

        afterEach(() => {
            if (originalUserAgentData) {
                Object.defineProperty(window.navigator, 'userAgentData', originalUserAgentData)
            } else {
                delete (window.navigator as any).userAgentData
            }
            if (originalBrave) {
                Object.defineProperty(window.navigator, 'brave', originalBrave)
            } else {
                delete (window.navigator as any).brave
            }
        })

        it('returns empty hints when neither signal is present', () => {
            delete (window.navigator as any).userAgentData
            delete (window.navigator as any).brave
            expect(getBrowserDetectionHints()).toEqual({})
        })

        it('forwards userAgentData.brands when present', () => {
            const brands = [
                { brand: 'Chromium', version: '120' },
                { brand: 'Arc', version: '1.27' },
            ]
            Object.defineProperty(window.navigator, 'userAgentData', {
                value: { brands },
                configurable: true,
            })
            expect(getBrowserDetectionHints()).toEqual({ userAgentDataBrands: brands })
        })

        it('flags brave when navigator.brave exists', () => {
            Object.defineProperty(window.navigator, 'brave', {
                value: { isBrave: () => Promise.resolve(true) },
                configurable: true,
            })
            expect(getBrowserDetectionHints()).toEqual({ brave: true })
        })

        it('combines both signals when both are available', () => {
            const brands = [{ brand: 'Brave', version: '1.62' }]
            Object.defineProperty(window.navigator, 'userAgentData', {
                value: { brands },
                configurable: true,
            })
            Object.defineProperty(window.navigator, 'brave', { value: {}, configurable: true })
            expect(getBrowserDetectionHints()).toEqual({ userAgentDataBrands: brands, brave: true })
        })
    })

    describe('Arc detection end-to-end', () => {
        const originalUserAgentData = Object.getOwnPropertyDescriptor(window.navigator, 'userAgentData')
        const chromeMacOsUA =
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

        beforeEach(() => {
            // @ts-expect-error ok to set global in test
            globals['userAgent'] = chromeMacOsUA
        })

        afterEach(() => {
            if (originalUserAgentData) {
                Object.defineProperty(window.navigator, 'userAgentData', originalUserAgentData)
            } else {
                delete (window.navigator as any).userAgentData
            }
        })

        it('reports $browser as Arc when Client Hints advertises Arc, even on a Chrome UA', () => {
            Object.defineProperty(window.navigator, 'userAgentData', {
                value: {
                    brands: [
                        { brand: 'Not_A Brand', version: '8' },
                        { brand: 'Chromium', version: '120' },
                        { brand: 'Arc', version: '1.27' },
                    ],
                },
                configurable: true,
            })
            const properties = getEventProperties()
            expect(properties['$browser']).toBe('Arc')
            expect(properties['$browser_version']).toBe(1.27)
        })

        it('reports $browser as Chrome when Client Hints does not advertise Arc', () => {
            delete (window.navigator as any).userAgentData
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
        let languageGetter: jest.SpyInstance

        beforeEach(() => {
            languageGetter = jest.spyOn(window.navigator, 'language', 'get')
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
