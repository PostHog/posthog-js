/* eslint-disable compat/compat */
/**
 * Tests for the opt-in snippet unload fallback (snippet/unload-fallback.js),
 * pasted alongside the classic snippet (snippet/snippet.js).
 *
 * Both files are executed as-is in jsdom via `new Function`, so these tests
 * exercise the exact code shared with customers, not a re-implementation.
 * Every listener registered during a test is removed again afterwards, so
 * each test observes exactly the listeners a real page would have.
 */
import * as fs from 'fs'
import * as path from 'path'

import Config from '../config'
import { init_from_snippet } from '../posthog-core'
import { assignableWindow } from '../utils/globals'

const snippetSource = fs.readFileSync(path.join(__dirname, '../../snippet/snippet.js'), 'utf8')
const fallbackSource = fs.readFileSync(path.join(__dirname, '../../snippet/unload-fallback.js'), 'utf8')

const TOKEN = 'test_token'
const API_HOST = 'https://app.example.com'

const runClassicSnippet = () => new Function(snippetSource)()
const runFallback = () => new Function(fallbackSource)()
const runSnippet = () => {
    runClassicSnippet()
    runFallback()
}

const snippetPosthog = (): any => (window as any).posthog

const firePagehide = () => {
    window.dispatchEvent(new Event('onpagehide' in window ? 'pagehide' : 'unload'))
}

const readBlob = (blob: Blob): Promise<string> =>
    new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsText(blob)
    })

const clearCookies = () => {
    for (const cookie of document.cookie.split(';')) {
        const name = cookie.split('=')[0].trim()
        if (name) {
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`
        }
    }
}

const queuedCaptures = (queue: any[] = snippetPosthog()): any[] => queue.filter((item) => item && item[0] === 'capture')

const ORIGINAL_USER_AGENT = window.navigator.userAgent

describe('snippet unload fallback', () => {
    let sendBeaconMock: jest.Mock
    let registeredListeners: [string, EventListenerOrEventListenerObject][]

    beforeEach(() => {
        registeredListeners = []
        const originalAddEventListener = window.addEventListener.bind(window)
        jest.spyOn(window, 'addEventListener').mockImplementation((type: any, listener: any, options?: any) => {
            registeredListeners.push([type, listener])
            return originalAddEventListener(type, listener, options)
        })
        ;(window as any).posthog = undefined
        localStorage.clear()
        sessionStorage.clear()
        clearCookies()
        delete (window as any).doNotTrack

        sendBeaconMock = jest.fn(() => true)
        Object.defineProperty(window.navigator, 'sendBeacon', {
            value: sendBeaconMock,
            configurable: true,
            writable: true,
        })
        Object.defineProperty(window.navigator, 'doNotTrack', { value: undefined, configurable: true, writable: true })
        Object.defineProperty(window.navigator, 'webdriver', { value: undefined, configurable: true, writable: true })
        Object.defineProperty(window.navigator, 'userAgent', {
            value: ORIGINAL_USER_AGENT,
            configurable: true,
            writable: true,
        })
    })

    afterEach(() => {
        jest.restoreAllMocks()
        for (const [type, listener] of registeredListeners) {
            window.removeEventListener(type, listener)
        }
        document.querySelectorAll('script[src*="/static/array.full.js"]').forEach((el) => el.remove())
    })

    const decodeBeaconCall = async (callIndex = 0): Promise<{ url: string; events: any[] }> => {
        const [url, blob] = sendBeaconMock.mock.calls[callIndex]
        expect(blob).toBeInstanceOf(Blob)
        expect((blob as Blob).type).toBe('application/x-www-form-urlencoded')
        const body = await readBlob(blob as Blob)
        expect(body.startsWith('data=')).toBe(true)
        const json = Buffer.from(decodeURIComponent(body.slice('data='.length)), 'base64').toString('utf8')
        return { url, events: JSON.parse(json) }
    }

    describe('the fallback is opt-in', () => {
        it('the classic snippet alone never beacons on pagehide', () => {
            runClassicSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('early-event')

            firePagehide()

            expect(sendBeaconMock).not.toHaveBeenCalled()
            expect(queuedCaptures()).toHaveLength(1)
        })

        it('the fallback alone is a no-op without the snippet', () => {
            runFallback()

            expect(() => firePagehide()).not.toThrow()
            expect(sendBeaconMock).not.toHaveBeenCalled()
        })

        it('works when pasted above the snippet', () => {
            runFallback()
            runClassicSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('early-event')

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
        })

        it('pasting the fallback twice still sends each capture only once', () => {
            runClassicSnippet()
            runFallback()
            runFallback()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('early-event')

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
        })
    })

    describe('loader script insertion', () => {
        it('appends the loader script to head even when the document has no script element', () => {
            // e.g. a programmatically created iframe document
            document.querySelectorAll('script').forEach((el) => el.remove())

            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })

            const loader = document.head.querySelector<HTMLScriptElement>(
                `script[src="${API_HOST}/static/array.full.js"]`
            )
            expect(loader).not.toBeNull()
            expect(loader!.crossOrigin).toBe('anonymous')
            expect(loader!.async).toBe(true)
        })
    })

    describe('sending queued captures on pagehide', () => {
        it.each([
            ['a plain api_host', { api_host: API_HOST }, `${API_HOST}/e/?compression=base64`],
            ['a trailing-slash api_host', { api_host: `${API_HOST}/` }, `${API_HOST}/e/?compression=base64`],
            ['no api_host', {}, 'https://us.i.posthog.com/e/?compression=base64'],
        ])('beacons to the events endpoint for %s', async (_name, config, expectedUrl) => {
            runSnippet()
            snippetPosthog().init(TOKEN, config)
            snippetPosthog().capture('early-event')

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
            const { url } = await decodeBeaconCall()
            expect(url).toBe(expectedUrl)
        })

        it('builds the event payload from the queued capture', async () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('early-event', {
                custom: 'value',
                // reserved keys must not be overridable by user properties
                token: 'not-the-token',
                $sent_by_snippet_fallback_on_unload: 'nope',
            })

            firePagehide()

            const { events } = await decodeBeaconCall()
            expect(events).toHaveLength(1)
            const event = events[0]
            expect(Object.keys(event).sort()).toEqual(['event', 'properties'])
            expect(event.event).toBe('early-event')
            expect(event.properties).toMatchObject({
                custom: 'value',
                token: TOKEN,
                $lib: 'web-snippet',
                $current_url: window.location.href,
                $sent_by_snippet_fallback_on_unload: true,
                $process_person_profile: false,
            })
            expect(typeof event.properties.distinct_id).toBe('string')
        })

        it('sends all queued captures in a single beacon', async () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('one')
            snippetPosthog().capture('two', { n: 2 })

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
            const { events } = await decodeBeaconCall()
            expect(events.map((e) => e.event)).toEqual(['one', 'two'])
        })

        it('beacons each initialized instance separately', async () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().init('other_token', { api_host: 'https://eu.example.com' }, 'ph2')
            snippetPosthog().capture('default-event')
            snippetPosthog().ph2.capture('named-event')

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(2)
            const first = await decodeBeaconCall(0)
            const second = await decodeBeaconCall(1)
            expect(first.url).toBe(`${API_HOST}/e/?compression=base64`)
            expect(first.events[0]).toMatchObject({ event: 'default-event', properties: { token: TOKEN } })
            expect(second.url).toBe('https://eu.example.com/e/?compression=base64')
            expect(second.events[0]).toMatchObject({ event: 'named-event', properties: { token: 'other_token' } })
            expect(queuedCaptures()).toHaveLength(0)
            expect(queuedCaptures(snippetPosthog().ph2)).toHaveLength(0)
        })
    })

    describe('identity resolution', () => {
        const storedProps = (props: Record<string, any>) => JSON.stringify(props)

        it.each([
            [
                'localStorage',
                () => localStorage.setItem(`ph_${TOKEN}_posthog`, storedProps({ distinct_id: 'stored-id' })),
                {},
                'stored-id',
                false,
            ],
            [
                'localStorage with person processing enabled',
                () =>
                    localStorage.setItem(`ph_${TOKEN}_posthog`, storedProps({ distinct_id: 'stored-id', $epp: true })),
                {},
                'stored-id',
                true,
            ],
            [
                'sessionStorage',
                () => sessionStorage.setItem(`ph_${TOKEN}_posthog`, storedProps({ distinct_id: 'session-id' })),
                {},
                'session-id',
                false,
            ],
            [
                'cookie',
                () => {
                    document.cookie = `ph_${TOKEN}_posthog=${encodeURIComponent(storedProps({ distinct_id: 'cookie-id' }))}`
                },
                {},
                'cookie-id',
                false,
            ],
            [
                'persistence_name override',
                () => localStorage.setItem('ph_custom', storedProps({ distinct_id: 'custom-id' })),
                { persistence_name: 'custom' },
                'custom-id',
                false,
            ],
            [
                'localStorage with person_profiles always',
                () => localStorage.setItem(`ph_${TOKEN}_posthog`, storedProps({ distinct_id: 'stored-id' })),
                { person_profiles: 'always' },
                'stored-id',
                true,
            ],
        ])(
            'uses the distinct_id persisted in %s',
            async (_name, seed, extraConfig, expectedId, expectedPersonProfile) => {
                seed()
                runSnippet()
                snippetPosthog().init(TOKEN, { api_host: API_HOST, ...extraConfig })
                snippetPosthog().capture('early-event')

                firePagehide()

                const { events } = await decodeBeaconCall()
                expect(events[0].properties.distinct_id).toBe(expectedId)
                expect(events[0].properties.$process_person_profile).toBe(expectedPersonProfile)
            }
        )

        it('sanitizes the token when building the persistence key', async () => {
            const awkwardToken = 'tok+en/wat='
            localStorage.setItem('ph_tokPLenSLwatEQ_posthog', storedProps({ distinct_id: 'sanitized-id' }))
            runSnippet()
            snippetPosthog().init(awkwardToken, { api_host: API_HOST })
            snippetPosthog().capture('early-event')

            firePagehide()

            const { events } = await decodeBeaconCall()
            expect(events[0].properties.distinct_id).toBe('sanitized-id')
        })

        it('prefers a queued identify id over a stored id and enables person processing', async () => {
            localStorage.setItem(`ph_${TOKEN}_posthog`, storedProps({ distinct_id: 'stored-id' }))
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('before-identify')
            snippetPosthog().identify('identified-id')
            snippetPosthog().identify('identified-id-2')

            firePagehide()

            const { events } = await decodeBeaconCall()
            // the real drain applies identify before captures, so the last identify wins for all of them
            expect(events[0].properties.distinct_id).toBe('identified-id-2')
            expect(events[0].properties.$process_person_profile).toBe(true)
        })

        it('generates a personless throwaway id when nothing is stored', async () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('early-event')

            firePagehide()

            const { events } = await decodeBeaconCall()
            expect(events[0].properties.distinct_id).toMatch(/^snippet-/)
            expect(events[0].properties.$process_person_profile).toBe(false)
        })

        it('respects person_profiles always for a generated id', async () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST, person_profiles: 'always' })
            snippetPosthog().capture('early-event')

            firePagehide()

            const { events } = await decodeBeaconCall()
            expect(events[0].properties.distinct_id).toMatch(/^snippet-/)
            expect(events[0].properties.$process_person_profile).toBe(true)
        })
    })

    describe('never sends when the SDK would not', () => {
        const consentKey = `__ph_opt_in_out_${TOKEN}`

        it.each([
            ['consent 0 in localStorage', {}, () => localStorage.setItem(consentKey, '0')],
            ['consent false in localStorage', {}, () => localStorage.setItem(consentKey, 'false')],
            ['consent no in localStorage', {}, () => localStorage.setItem(consentKey, 'no')],
            [
                'consent 0 in a cookie',
                {},
                () => {
                    document.cookie = `${consentKey}=0`
                },
            ],
            ['pending consent with opt_out_capturing_by_default', { opt_out_capturing_by_default: true }, () => {}],
            [
                'consent 0 under a custom cookie prefix',
                { opt_out_capturing_cookie_prefix: '__custom_' },
                () => localStorage.setItem(`__custom_${TOKEN}`, '0'),
            ],
            [
                'consent 0 under consent_persistence_name',
                { consent_persistence_name: 'my_consent' },
                () => localStorage.setItem('my_consent', '0'),
            ],
            [
                'respect_dnt with navigator.doNotTrack',
                { respect_dnt: true },
                () => {
                    Object.defineProperty(window.navigator, 'doNotTrack', { value: '1', configurable: true }) // eslint-disable-line compat/compat
                },
            ],
            [
                'respect_dnt with window.doNotTrack',
                { respect_dnt: true },
                () => {
                    ;(window as any).doNotTrack = '1'
                },
            ],
            ['cookieless_mode always', { cookieless_mode: 'always' }, () => {}],
            ['cookieless_mode on_reject', { cookieless_mode: 'on_reject' }, () => {}],
            ['disable_beacon', { disable_beacon: true }, () => {}],
            ['__preview_disable_beacon', { __preview_disable_beacon: true }, () => {}],
            // a customized event pipeline must not be bypassed
            ['a before_send hook', { before_send: () => null }, () => {}],
            ['a sanitize_properties hook', { sanitize_properties: (props: any) => props }, () => {}],
            ['a property_blacklist', { property_blacklist: ['secret'] }, () => {}],
            ['a property_denylist', { property_denylist: ['secret'] }, () => {}],
            ['custom request_headers', { request_headers: { Authorization: 'Bearer x' } }, () => {}],
            // the SDK's bot filtering never ran, so bot traffic is skipped
            [
                'an automated browser',
                {},
                () => {
                    Object.defineProperty(window.navigator, 'webdriver', { value: true, configurable: true })
                },
            ],
            [
                'a bot user agent',
                {},
                () => {
                    Object.defineProperty(window.navigator, 'userAgent', {
                        value: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                        configurable: true,
                    })
                },
            ],
            [
                'a headless browser user agent',
                {},
                () => {
                    Object.defineProperty(window.navigator, 'userAgent', {
                        value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/136.0.0.0 Safari/537.36',
                        configurable: true,
                    })
                },
            ],
        ])('%s', (_name, config, seed) => {
            seed()
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST, ...config })
            snippetPosthog().capture('early-event')

            firePagehide()

            expect(sendBeaconMock).not.toHaveBeenCalled()
            // the queue is left for array.js and its full consent machinery
            expect(queuedCaptures()).toHaveLength(1)
        })

        it.each(['1', 'true', 'yes'])(
            'sends when stored consent is %s even with opt_out_capturing_by_default',
            (consentValue) => {
                localStorage.setItem(consentKey, consentValue)
                runSnippet()
                snippetPosthog().init(TOKEN, { api_host: API_HOST, opt_out_capturing_by_default: true })
                snippetPosthog().capture('early-event')

                firePagehide()

                expect(sendBeaconMock).toHaveBeenCalledTimes(1)
            }
        )

        it('sends for a visitor who has not opted out', () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST, respect_dnt: true })
            snippetPosthog().capture('early-event')

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
        })

        it('sends from an automated browser when opt_out_useragent_filter is set, matching the SDK', () => {
            Object.defineProperty(window.navigator, 'webdriver', { value: true, configurable: true })
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST, opt_out_useragent_filter: true })
            snippetPosthog().capture('early-event')

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
        })
    })

    describe('queued consent calls', () => {
        // the real drain replays consent calls before captures, so the last
        // queued opt_in/opt_out call decides here too
        const setup = (config: Record<string, any> = {}) => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST, ...config })
        }

        it('respects a queued opt_out_capturing and leaves the whole queue for array.js', () => {
            setup()
            snippetPosthog().capture('early-event')
            snippetPosthog().opt_out_capturing()

            firePagehide()

            expect(sendBeaconMock).not.toHaveBeenCalled()
            const remaining = snippetPosthog()
                .filter((item: any) => item)
                .map((item: any) => item[0])
            expect(remaining).toEqual(['capture', 'opt_out_capturing'])
        })

        it.each([
            ['opt_out then opt_in sends', ['opt_out_capturing', 'opt_in_capturing'], 1],
            ['opt_in then opt_out does not send', ['opt_in_capturing', 'opt_out_capturing'], 0],
        ])('%s', (_name, calls, expectedBeacons) => {
            setup()
            snippetPosthog().capture('early-event')
            for (const call of calls) {
                snippetPosthog()[call]()
            }

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(expectedBeacons)
        })

        it('a queued opt_in_capturing overrides stored opt-out consent', () => {
            localStorage.setItem(`__ph_opt_in_out_${TOKEN}`, '0')
            setup()
            snippetPosthog().capture('early-event')
            snippetPosthog().opt_in_capturing()

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
        })

        it('a queued opt_in_capturing overrides opt_out_capturing_by_default', () => {
            setup({ opt_out_capturing_by_default: true })
            snippetPosthog().capture('early-event')
            snippetPosthog().opt_in_capturing()

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
        })

        it('defers to array.js when a set_config call is queued', () => {
            setup()
            snippetPosthog().capture('early-event')
            snippetPosthog().set_config({ opt_out_capturing_by_default: true })

            firePagehide()

            expect(sendBeaconMock).not.toHaveBeenCalled()
            expect(queuedCaptures()).toHaveLength(1)
        })
    })

    describe('payload bounds', () => {
        it('sends at most 50 captures and leaves the remainder queued', async () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            for (let i = 0; i < 60; i++) {
                snippetPosthog().capture(`event-${i}`)
            }

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
            const { events } = await decodeBeaconCall()
            expect(events).toHaveLength(50)
            expect(events[0].event).toBe('event-0')
            expect(events[49].event).toBe('event-49')
            expect(queuedCaptures()).toHaveLength(10)
        })

        it('leaves the queue intact when the encoded body would exceed the beacon limit', () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('huge-event', { blob: 'x'.repeat(70 * 1024) })

            firePagehide()

            expect(sendBeaconMock).not.toHaveBeenCalled()
            expect(queuedCaptures()).toHaveLength(1)
        })
    })

    describe('dedupe and race safety', () => {
        it('sends captures at most once across repeated pagehides and keeps other calls queued', async () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().identify('user-1')
            snippetPosthog().register({ plan: 'pro' })
            snippetPosthog().capture('early-event')

            firePagehide()
            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
            expect(queuedCaptures()).toHaveLength(0)
            const remaining = snippetPosthog()
                .filter((item: any) => item)
                .map((item: any) => item[0])
            expect(remaining).toEqual(['identify', 'register'])
        })

        it('is a no-op once the real SDK has loaded', () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('early-event')
            // simulate array.js having taken over (it replaces window.posthog wholesale)
            ;(window as any).posthog = { __loaded: true, _i: [[TOKEN, { api_host: API_HOST }, 'posthog']] }

            firePagehide()

            expect(sendBeaconMock).not.toHaveBeenCalled()
        })

        it('does not throw when window.posthog has been removed', () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            ;(window as any).posthog = undefined

            expect(() => firePagehide()).not.toThrow()
            expect(sendBeaconMock).not.toHaveBeenCalled()
        })

        describe('against the real array.js drain', () => {
            afterEach(() => {
                Config.SDK_DIST_CHANNEL = undefined
                assignableWindow.posthog = undefined as any
            })

            const quietConfig = (): Record<string, any> => ({
                api_host: API_HOST,
                autocapture: false,
                capture_pageview: false,
                disable_session_recording: true,
                disable_surveys: true,
                advanced_disable_flags: true,
                disable_compression: true,
            })

            // the drain is observed via a before_send spy attached to the live
            // config object only after pagehide - configuring it up front would
            // (correctly) disable the fallback as a customized pipeline

            it('never delivers a beaconed capture to the drain', () => {
                const beforeSend = jest.fn(() => null)
                const config = quietConfig()
                runSnippet()
                snippetPosthog().init(TOKEN, config)
                snippetPosthog().capture('early-event')

                firePagehide()
                expect(sendBeaconMock).toHaveBeenCalledTimes(1)

                config.before_send = beforeSend
                init_from_snippet()

                const drainedEvents = beforeSend.mock.calls.map(([event]: any[]) => event.event)
                expect(drainedEvents).not.toContain('early-event')
            })

            it('control: without a pagehide the drain delivers the queued capture', () => {
                const beforeSend = jest.fn(() => null)
                const config = quietConfig()
                runSnippet()
                snippetPosthog().init(TOKEN, config)
                snippetPosthog().capture('early-event')

                config.before_send = beforeSend
                init_from_snippet()

                const drainedEvents = beforeSend.mock.calls.map(([event]: any[]) => event.event)
                expect(drainedEvents).toContain('early-event')
                expect(sendBeaconMock).not.toHaveBeenCalled()
            })
        })
    })

    describe('robustness', () => {
        it('does nothing when sendBeacon is unavailable', () => {
            Object.defineProperty(window.navigator, 'sendBeacon', {
                value: undefined,
                configurable: true,
                writable: true,
            })
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('early-event')

            expect(() => firePagehide()).not.toThrow()
            expect(queuedCaptures()).toHaveLength(1)
        })

        it('leaves the queue intact when sendBeacon rejects the payload', () => {
            sendBeaconMock.mockReturnValue(false)
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('early-event')

            firePagehide()

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
            expect(queuedCaptures()).toHaveLength(1)
        })

        it('falls back to a generated id when storage access throws', async () => {
            const originalLocalStorage = window.localStorage
            Object.defineProperty(window, 'localStorage', {
                configurable: true,
                get: () => {
                    throw new Error('denied')
                },
            })
            try {
                runSnippet()
                snippetPosthog().init(TOKEN, { api_host: API_HOST })
                snippetPosthog().capture('early-event')

                firePagehide()
            } finally {
                Object.defineProperty(window, 'localStorage', {
                    configurable: true,
                    value: originalLocalStorage,
                })
            }

            expect(sendBeaconMock).toHaveBeenCalledTimes(1)
            const { events } = await decodeBeaconCall()
            expect(events[0].properties.distinct_id).toMatch(/^snippet-/)
        })

        it('falls back to a generated id when the stored persistence is malformed', async () => {
            localStorage.setItem(`ph_${TOKEN}_posthog`, 'not json at all')
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('early-event')

            firePagehide()

            const { events } = await decodeBeaconCall()
            expect(events[0].properties.distinct_id).toMatch(/^snippet-/)
        })

        it('sends nothing when no captures are queued', () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().identify('user-1')

            firePagehide()

            expect(sendBeaconMock).not.toHaveBeenCalled()
        })

        it('ignores captures without a string event name and keeps them queued', () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture(123)

            firePagehide()

            expect(sendBeaconMock).not.toHaveBeenCalled()
            expect(queuedCaptures()).toHaveLength(1)
        })

        it('handles unicode in event names and properties', async () => {
            runSnippet()
            snippetPosthog().init(TOKEN, { api_host: API_HOST })
            snippetPosthog().capture('événement-🦔', { emoji: '✨' })

            firePagehide()

            const { events } = await decodeBeaconCall()
            expect(events[0].event).toBe('événement-🦔')
            expect(events[0].properties.emoji).toBe('✨')
        })
    })
})
