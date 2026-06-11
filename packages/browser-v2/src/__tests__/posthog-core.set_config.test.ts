import { defaultPostHog } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import Config from '../config'

describe('posthog.setConfig', () => {
    const mockURL = jest.fn()
    const mockReferrer = jest.fn()
    const originalWindowLocation = window.location

    beforeEach(() => {
        mockReferrer.mockReturnValue('https://referrer.com')
        mockURL.mockReturnValue('https://example.com')
        console.error = jest.fn()
        console.log = jest.fn()

        // Mock getters using Object.defineProperty
        Object.defineProperty(document, 'URL', {
            get: mockURL,
            configurable: true,
        })
        Object.defineProperty(document, 'referrer', {
            get: mockReferrer,
            configurable: true,
        })

        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            writable: true,
            // eslint-disable-next-line compat/compat
            value: new URL('https://example.com'),
        })

        // Clear localStorage before each test
        localStorage.clear()
        // Reset Config.DEBUG to default
        Config.DEBUG = false
    })

    afterEach(() => {
        defaultPostHog().reset()
        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            value: originalWindowLocation,
        })
        localStorage.clear()
        Config.DEBUG = false
    })

    describe('debug flag behavior', () => {
        it.each([
            { initial: false, setValue: true, expectedDebug: true, expectedStorage: 'true' },
            { initial: true, setValue: false, expectedDebug: false, expectedStorage: null },
        ])(
            'should set debug to $setValue when initially $initial',
            ({ initial, setValue, expectedDebug, expectedStorage }) => {
                const token = uuidv7()
                const posthog = defaultPostHog().init(token, { debug: initial }, token)!

                posthog.setConfig({ debug: setValue })

                expect(posthog.config.debug).toBe(expectedDebug)
                expect(Config.DEBUG).toBe(expectedDebug)
                expect(localStorage.getItem('ph_debug')).toBe(expectedStorage)
            }
        )

        it('should read ph_debug from localStorage when debug defaults to false', () => {
            // Even if ph_debug is in localStorage, default config sets debug to false
            localStorage.setItem('ph_debug', 'true')
            const token = uuidv7()

            const posthog = defaultPostHog().init(token, {}, token)!

            expect(posthog.config.debug).toBe(true)
            expect(Config.DEBUG).toBe(true)
        })

        it('should persist debug=true to localStorage when set', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, {}, token)!
            expect(localStorage.getItem('ph_debug')).toBeNull()

            posthog.setConfig({ debug: true })

            expect(localStorage.getItem('ph_debug')).toBe('true')
        })

        it('should remove ph_debug from localStorage when debug is set to false', () => {
            // localStore._get returns raw value, so we set 'true' without JSON serialization
            localStorage.setItem('ph_debug', 'true')
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, {}, token)!

            posthog.setConfig({ debug: false })

            expect(localStorage.getItem('ph_debug')).toBeNull()
        })

        it('should toggle debug mode multiple times', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, { debug: false }, token)!

            posthog.setConfig({ debug: true })
            expect(posthog.config.debug).toBe(true)
            expect(Config.DEBUG).toBe(true)
            expect(localStorage.getItem('ph_debug')).toBe('true')

            posthog.setConfig({ debug: false })
            expect(posthog.config.debug).toBe(false)
            expect(Config.DEBUG).toBe(false)
            expect(localStorage.getItem('ph_debug')).toBeNull()

            posthog.setConfig({ debug: true })
            expect(posthog.config.debug).toBe(true)
            expect(Config.DEBUG).toBe(true)
            expect(localStorage.getItem('ph_debug')).toBe('true')
        })

        it('should not modify debug if not a boolean', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, { debug: false }, token)!
            const initialDebug = posthog.config.debug
            const initialConfigDebug = Config.DEBUG

            posthog.setConfig({ apiHost: 'https://new-host.com' })

            expect(posthog.config.debug).toBe(initialDebug)
            expect(Config.DEBUG).toBe(initialConfigDebug)
        })
    })

    describe('general config updates', () => {
        it('should update simple config values', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, {}, token)!

            posthog.setConfig({ apiHost: 'https://new-host.com' })

            expect(posthog.config.apiHost).toBe('https://new-host.com')
        })

        it('should update multiple config values at once', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, {}, token)!

            posthog.setConfig({
                apiHost: 'https://new-host.com',
                capturePageview: false,
                capturePageleave: false,
            })

            expect(posthog.config.apiHost).toBe('https://new-host.com')
            expect(posthog.config.capturePageview).toBe(false)
            expect(posthog.config.capturePageleave).toBe(false)
        })

        it('should preserve existing config when updating subset of values', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(
                token,
                {
                    apiHost: 'https://original.com',
                    capturePageview: true,
                },
                token
            )!

            posthog.setConfig({ capturePageview: false })

            expect(posthog.config.apiHost).toBe('https://original.com')
            expect(posthog.config.capturePageview).toBe(false)
        })

        it('should handle empty config object', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, { debug: false }, token)!
            const originalConfig = { ...posthog.config }

            posthog.setConfig({})

            expect(posthog.config.debug).toBe(originalConfig.debug)
            expect(posthog.config.apiHost).toBe(originalConfig.apiHost)
        })
    })

    describe('persistence configuration', () => {
        it('should update session persistence when persistence type changes', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, { persistence: 'localStorage' }, token)!

            // When persistence is localStorage, sessionPersistence is a separate sessionStorage object
            const originalSessionPersistence = posthog.sessionPersistence
            expect(originalSessionPersistence).not.toBe(posthog.persistence)

            posthog.setConfig({ persistence: 'cookie' })

            // After changing to cookie, sessionPersistence should be recreated
            expect(posthog.sessionPersistence).not.toBe(originalSessionPersistence)
        })

        it.each([{ persistenceType: 'sessionStorage' }, { persistenceType: 'memory' }] as const)(
            'should keep session persistence same as persistence for $persistenceType',
            ({ persistenceType }) => {
                const token = uuidv7()
                const posthog = defaultPostHog().init(token, { persistence: 'cookie' }, token)!

                posthog.setConfig({ persistence: persistenceType })

                expect(posthog.sessionPersistence).toBe(posthog.persistence)
            }
        )
    })

    describe('session recording config', () => {
        it('should update disableSessionRecording config', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, { disableSessionRecording: false }, token)!

            posthog.setConfig({ disableSessionRecording: true })

            expect(posthog.config.disableSessionRecording).toBe(true)
        })
    })
})
