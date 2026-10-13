import { defaultPostHog } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import Config from '../config'

describe('posthog.set_config', () => {
    const mockURL = vi.fn()
    const mockReferrer = vi.fn()
    const originalWindowLocation = window.location

    beforeEach(() => {
        mockReferrer.mockReturnValue('https://referrer.com')
        mockURL.mockReturnValue('https://example.com')
        console.error = vi.fn()
        console.log = vi.fn()

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

                posthog.set_config({ debug: setValue })

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

            posthog.set_config({ debug: true })

            expect(localStorage.getItem('ph_debug')).toBe('true')
        })

        it('should remove ph_debug from localStorage when debug is set to false', () => {
            // localStore._get returns raw value, so we set 'true' without JSON serialization
            localStorage.setItem('ph_debug', 'true')
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, {}, token)!

            posthog.set_config({ debug: false })

            expect(localStorage.getItem('ph_debug')).toBeNull()
        })

        it('should toggle debug mode multiple times', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, { debug: false }, token)!

            posthog.set_config({ debug: true })
            expect(posthog.config.debug).toBe(true)
            expect(Config.DEBUG).toBe(true)
            expect(localStorage.getItem('ph_debug')).toBe('true')

            posthog.set_config({ debug: false })
            expect(posthog.config.debug).toBe(false)
            expect(Config.DEBUG).toBe(false)
            expect(localStorage.getItem('ph_debug')).toBeNull()

            posthog.set_config({ debug: true })
            expect(posthog.config.debug).toBe(true)
            expect(Config.DEBUG).toBe(true)
            expect(localStorage.getItem('ph_debug')).toBe('true')
        })

        it('preserves debug when set_config omits debug', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, { debug: false }, token)!
            const initialDebug = posthog.config.debug
            const initialConfigDebug = Config.DEBUG

            posthog.set_config({ api_host: 'https://new-host.com' })

            expect(posthog.config.debug).toBe(initialDebug)
            expect(Config.DEBUG).toBe(initialConfigDebug)
        })
    })

    describe('general config updates', () => {
        it('should update simple config values', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, {}, token)!

            posthog.set_config({ api_host: 'https://new-host.com' })

            expect(posthog.config.api_host).toBe('https://new-host.com')
        })

        it('should update multiple config values at once', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, {}, token)!

            posthog.set_config({
                api_host: 'https://new-host.com',
                capture_pageview: false,
                capture_pageleave: false,
            })

            expect(posthog.config.api_host).toBe('https://new-host.com')
            expect(posthog.config.capture_pageview).toBe(false)
            expect(posthog.config.capture_pageleave).toBe(false)
        })

        it('should preserve existing config when updating subset of values', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(
                token,
                {
                    api_host: 'https://original.com',
                    capture_pageview: true,
                },
                token
            )!

            posthog.set_config({ capture_pageview: false })

            expect(posthog.config.api_host).toBe('https://original.com')
            expect(posthog.config.capture_pageview).toBe(false)
        })

        it('should handle empty config object', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, { debug: false }, token)!
            const originalConfig = { ...posthog.config }

            posthog.set_config({})

            expect(posthog.config.debug).toBe(originalConfig.debug)
            expect(posthog.config.api_host).toBe(originalConfig.api_host)
        })

        it('should apply capture_pageview updates to history autocapture', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, { capture_pageview: false }, token)!
            const startIfEnabledOrStop = vi.spyOn(posthog.historyAutocapture!, 'startIfEnabledOrStop')

            posthog.set_config({ capture_pageview: { hash: true } })

            expect(startIfEnabledOrStop).toHaveBeenCalledTimes(1)
        })
    })

    describe('persistence configuration', () => {
        it('should retain session persistence when switching between persistent backends', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, { persistence: 'localStorage' }, token)!

            // When persistence is localStorage, sessionPersistence is a separate sessionStorage object
            const originalSessionPersistence = posthog.sessionPersistence
            expect(originalSessionPersistence).not.toBe(posthog.persistence)

            posthog.set_config({ persistence: 'cookie' })

            expect(posthog.sessionPersistence).toBe(originalSessionPersistence)
        })

        describe('debounced session persistence', () => {
            beforeEach(() => vi.useFakeTimers())
            afterEach(() => {
                vi.clearAllTimers()
                vi.useRealTimers()
            })

            it('preserves pending session properties when updating configuration', () => {
                const token = uuidv7()
                const posthog = defaultPostHog().init(
                    token,
                    {
                        persistence: 'localStorage',
                        persistence_save_debounce_ms: 250,
                        capture_pageview: false,
                        before_send: () => null,
                    },
                    token
                )!
                vi.advanceTimersByTime(250)
                const sessionPersistence = posthog.sessionPersistence
                posthog.register_for_session({ signup_flow: 'campaign' })

                posthog.set_config({ capture_pageview: false })

                expect(posthog.sessionPersistence).toBe(sessionPersistence)
                expect(posthog.sessionPersistence?.props.signup_flow).toBe('campaign')
                vi.advanceTimersByTime(250)
                expect(JSON.parse(sessionStorage.getItem(`ph_${token}_posthog`)!)).toMatchObject({
                    signup_flow: 'campaign',
                })
            })

            it.each([0, 250])(
                'does not restore unregistered properties after leaving memory (debounce: %s)',
                (debounce) => {
                    const token = uuidv7()
                    const beforeSend = vi.fn(() => null)
                    const posthog = defaultPostHog().init(
                        token,
                        {
                            persistence: 'localStorage',
                            persistence_save_debounce_ms: debounce,
                            capture_pageview: false,
                            bootstrap: { distinctID: token },
                            before_send: beforeSend,
                        },
                        token
                    )!
                    posthog.register_for_session({ flow: 'signup' })
                    posthog.set_config({ persistence: 'memory' })
                    posthog.unregister_for_session('flow')
                    vi.advanceTimersByTime(250)
                    expect.soft(sessionStorage.getItem(`ph_${token}_posthog`)).toBeNull()

                    posthog.set_config({ persistence: 'localStorage' })
                    posthog.capture('returned from memory')
                    expect(beforeSend).toHaveBeenLastCalledWith(
                        expect.objectContaining({ properties: expect.not.objectContaining({ flow: 'signup' }) })
                    )
                    vi.advanceTimersByTime(250)
                    expect(JSON.parse(sessionStorage.getItem(`ph_${token}_posthog`)!)).not.toHaveProperty('flow')
                }
            )

            it.each(['sessionStorage', 'memory'] as const)(
                'switches to and from the shared %s backend without stale pending writes',
                (persistence) => {
                    const token = uuidv7()
                    const posthog = defaultPostHog().init(
                        token,
                        {
                            persistence: 'localStorage',
                            persistence_save_debounce_ms: 250,
                            capture_pageview: false,
                            bootstrap: { distinctID: token },
                        },
                        token
                    )!
                    const primaryPersistence = posthog.persistence
                    posthog.register_for_session({ flow: 'old' })

                    posthog.set_config({ persistence })
                    expect(posthog.sessionPersistence).toBe(primaryPersistence)
                    posthog.register_for_session({ flow: 'new' })
                    vi.advanceTimersByTime(250)
                    expect(posthog.sessionPersistence?.props.flow).toBe('new')
                    if (persistence === 'sessionStorage') {
                        expect(JSON.parse(sessionStorage.getItem(`ph_${token}_posthog`)!)).toMatchObject({
                            flow: 'new',
                        })
                    }

                    posthog.set_config({ persistence: 'localStorage' })
                    expect(posthog.persistence).toBe(primaryPersistence)
                    expect(posthog.sessionPersistence).not.toBe(primaryPersistence)
                    const sessionPersistence = posthog.sessionPersistence
                    posthog.register_for_session({ flow: 'returned' })
                    posthog.set_config({ capture_pageview: false })
                    expect(posthog.sessionPersistence).toBe(sessionPersistence)
                    vi.advanceTimersByTime(250)
                    expect(JSON.parse(sessionStorage.getItem(`ph_${token}_posthog`)!)).toMatchObject({
                        flow: 'returned',
                    })
                }
            )

            it.each([false, true])(
                'expires session properties after persistence is re-enabled (reload: %s)',
                (reload) => {
                    const token = uuidv7()
                    const beforeSend = vi.fn(() => null)
                    const init = (name: string) =>
                        defaultPostHog().init(
                            token,
                            {
                                persistence: 'localStorage',
                                persistence_save_debounce_ms: 250,
                                capture_pageview: false,
                                before_send: beforeSend,
                            },
                            name
                        )!
                    let posthog = init(token)
                    posthog.capture('landing')
                    const sessionId = posthog.get_session_id()
                    posthog.register_for_session({ signup_flow: 'campaign' })
                    vi.advanceTimersByTime(250)
                    const trackingKey = `ph_${token}_session_registered_properties`
                    expect(JSON.parse(sessionStorage.getItem(trackingKey)!)).toContain('signup_flow')

                    posthog.set_config({ disable_persistence: true })
                    posthog.capture('persistence disabled')
                    expect(beforeSend).toHaveBeenLastCalledWith(
                        expect.objectContaining({ properties: expect.objectContaining({ signup_flow: 'campaign' }) })
                    )
                    expect(posthog.get_session_id()).toBe(sessionId)
                    expect(sessionStorage.getItem(trackingKey)).toBeNull()

                    posthog.set_config({ disable_persistence: false })
                    posthog.capture('persistence re-enabled')
                    expect(JSON.parse(sessionStorage.getItem(trackingKey)!)).toContain('signup_flow')
                    expect(beforeSend).toHaveBeenLastCalledWith(
                        expect.objectContaining({ properties: expect.objectContaining({ signup_flow: 'campaign' }) })
                    )
                    expect(posthog.get_session_id()).toBe(sessionId)

                    vi.advanceTimersByTime(250)
                    if (reload) {
                        posthog = init(`${token}-reloaded`)
                        posthog.capture('reloaded')
                        expect(beforeSend).toHaveBeenLastCalledWith(
                            expect.objectContaining({
                                properties: expect.objectContaining({ signup_flow: 'campaign' }),
                            })
                        )
                        expect(posthog.get_session_id()).toBe(sessionId)
                    }

                    vi.setSystemTime(Date.now() + 31 * 60 * 1000)
                    posthog.capture('returned after timeout')
                    expect(posthog.get_session_id()).not.toBe(sessionId)
                    expect(beforeSend).toHaveBeenLastCalledWith(
                        expect.objectContaining({
                            properties: expect.not.objectContaining({ signup_flow: 'campaign' }),
                        })
                    )
                    vi.advanceTimersByTime(250)
                    expect(JSON.parse(sessionStorage.getItem(`ph_${token}_posthog`)!)).not.toHaveProperty('signup_flow')
                }
            )

            it('applies configuration changes to the existing session store', () => {
                const token = uuidv7()
                const posthog = defaultPostHog().init(
                    token,
                    { persistence: 'localStorage', persistence_save_debounce_ms: 250, capture_pageview: false },
                    token
                )!
                const sessionPersistence = posthog.sessionPersistence
                posthog.register_for_session({ signup_flow: 'campaign' })

                posthog.set_config({ persistence_save_debounce_ms: 0 })

                expect(posthog.sessionPersistence).toBe(sessionPersistence)
                expect(JSON.parse(sessionStorage.getItem(`ph_${token}_posthog`)!)).toMatchObject({
                    signup_flow: 'campaign',
                })
                posthog.set_config({ disable_persistence: true })
                vi.advanceTimersByTime(250)
                expect(sessionStorage.getItem(`ph_${token}_posthog`)).toBeNull()
                posthog.set_config({ disable_persistence: false })
                expect(JSON.parse(sessionStorage.getItem(`ph_${token}_posthog`)!)).toMatchObject({
                    signup_flow: 'campaign',
                })
            })
        })

        it.each([{ persistenceType: 'sessionStorage' }, { persistenceType: 'memory' }] as const)(
            'should keep session persistence same as persistence for $persistenceType',
            ({ persistenceType }) => {
                const token = uuidv7()
                // A stable bootstrap.distinctID suppresses the volatile-persistence warning that switching to
                // sessionStorage/memory now emits, keeping this test focused on the sessionPersistence identity.
                const posthog = defaultPostHog().init(
                    token,
                    { persistence: 'cookie', bootstrap: { distinctID: token } },
                    token
                )!

                posthog.set_config({ persistence: persistenceType })

                expect(posthog.sessionPersistence).toBe(posthog.persistence)
            }
        )
    })

    describe('session recording config', () => {
        it('should update disable_session_recording config', () => {
            const token = uuidv7()
            const posthog = defaultPostHog().init(token, { disable_session_recording: false }, token)!

            posthog.set_config({ disable_session_recording: true })

            expect(posthog.config.disable_session_recording).toBe(true)
        })
    })
})
