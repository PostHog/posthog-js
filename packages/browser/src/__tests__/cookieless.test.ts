import type { PostHogConfig } from '../types'
import { uuidv7 } from '../uuidv7'
import { createPosthogInstance } from './helpers/posthog-instance'
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

jest.mock('../utils/globals', () => {
    const orig = jest.requireActual('../utils/globals')
    const mockURLGetter = jest.fn()
    const mockReferrerGetter = jest.fn()
    const mockedCookieBox = { cookie: '' }
    const mockedFetch = jest.fn()
    return {
        ...orig,
        mockURLGetter,
        mockReferrerGetter,
        mockedCookieBox: mockedCookieBox,
        mockedFetch,
        document: {
            ...orig.document,
            createElement: (...args: any[]) => orig.document.createElement(...args),
            body: {},
            get referrer() {
                return mockReferrerGetter()
            },
            get URL() {
                return mockURLGetter()
            },
            get cookie() {
                return mockedCookieBox.cookie
            },
            set cookie(value: string) {
                mockedCookieBox.cookie = value
            },
            addEventListener(_, event, callback) {
                if (event === 'DOMContentLoaded') {
                    callback()
                }
            },
            readyState: 'complete',
            visibilityState: 'visible',
        },
        get location() {
            const url = mockURLGetter()
            return {
                href: url,
                toString: () => url,
            }
        },
        XMLHttpRequest: () => ({
            open: jest.fn(),
            send: jest.fn(),
            setRequestHeader: jest.fn(),
        }),
        fetch: mockedFetch,
    }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mockURLGetter, mockedCookieBox, mockedFetch, document } = require('../utils/globals')

const delay = (timeoutMs: number) => new Promise((resolve) => setTimeout(resolve, timeoutMs))

describe('cookieless', () => {
    const eventName = 'custom_event'
    const eventProperties = {
        event: 'prop',
    }
    const setup = async (config: Partial<PostHogConfig> = {}, token: string = uuidv7()) => {
        const beforeSendMock = jest.fn().mockImplementation((e) => e)
        const posthog = await createPosthogInstance(token, {
            ...config,
            before_send: beforeSendMock,
        })!
        posthog.debug()
        return { posthog, beforeSendMock }
    }

    beforeEach(() => {
        mockURLGetter.mockImplementation(() => 'http://localhost')
        mockedCookieBox.cookie = ''
        mockedFetch.mockResolvedValue({ status: 200, text: () => Promise.resolve('{"flags": {}}') })
    })

    describe('always mode', () => {
        it('should not set any cookies', async () => {
            const { posthog, beforeSendMock } = await setup({
                cookieless_mode: 'always',
            })
            expect(posthog.has_opted_in_capturing()).toBe(false)
            posthog.capture(eventName, eventProperties)

            expect(beforeSendMock).toBeCalledTimes(1)
            const event = beforeSendMock.mock.calls[0][0]
            expect(event.event).toBe(eventName)
            expect(event.properties.distinct_id).toBe('$posthog_cookieless')
            expect(event.properties.$anon_distinct_id).toBe(undefined)
            expect(event.properties.$device_id).toBe(null)
            expect(event.properties.$session_id).toBe(undefined)
            expect(event.properties.$window_id).toBe(undefined)
            expect(event.properties.$cookieless_mode).toEqual(true)
            expect(document.cookie).toBe('')
            expect(posthog.sessionRecording).toBeFalsy()

            // should ignore cookie consent, and throw in test code due to logging an error
            expect(() => posthog.opt_in_capturing()).toThrow()
        })

        it.each([[true], ['history_change']])(
            'should send the initial pageview event when capture_pageview is %p',
            async (capturePageview: PostHogConfig['capture_pageview']) => {
                const { posthog, beforeSendMock } = await setup({
                    cookieless_mode: 'always',
                    capture_pageview: capturePageview,
                })
                expect(posthog.has_opted_in_capturing()).toBe(false)
                await delay(1) // wait for async pageview capture

                expect(beforeSendMock).toBeCalledTimes(1)
                const event = beforeSendMock.mock.calls[0][0]
                expect(event.event).toBe('$pageview')
                expect(event.properties.distinct_id).toBe('$posthog_cookieless')
                expect(event.properties.$anon_distinct_id).toBe(undefined)
                expect(event.properties.$device_id).toBe(null)
                expect(event.properties.$session_id).toBe(undefined)
                expect(event.properties.$window_id).toBe(undefined)
                expect(event.properties.$cookieless_mode).toEqual(true)
                expect(document.cookie).toBe('')
                expect(posthog.sessionRecording).toBeFalsy()

                // should ignore cookie consent, and throw in test code due to logging an error
                expect(() => posthog.opt_in_capturing()).toThrow()
            }
        )
    })

    describe('on_reject mode', () => {
        it('should not send any events before opt in, then send non-cookieless events', async () => {
            const { posthog, beforeSendMock } = await setup({
                cookieless_mode: 'on_reject',
            })
            posthog.capture('eventBeforeOptIn') // will be dropped
            expect(beforeSendMock).toBeCalledTimes(0)
            expect(posthog.has_opted_out_capturing()).toEqual(true)

            // Mock surveys to verify they get loaded
            const mockSurveysLoadIfEnabled = jest.spyOn(posthog.surveys, 'loadIfEnabled')

            // opt in
            posthog.opt_in_capturing()

            expect(beforeSendMock).toBeCalledTimes(2)
            const optInEvent = beforeSendMock.mock.calls[0][0]
            expect(optInEvent.event).toBe('$opt_in')

            const initialPageview = beforeSendMock.mock.calls[1][0]
            expect(initialPageview.event).toBe('$pageview') // initial pageview
            expect(initialPageview.properties.distinct_id).toMatch(uuidV7Pattern)
            expect(initialPageview.properties.$anon_distinct_id).toBe(undefined)
            expect(initialPageview.properties.$device_id).toMatch(uuidV7Pattern)
            expect(initialPageview.properties.$session_id).toMatch(uuidV7Pattern)
            expect(initialPageview.properties.$window_id).toMatch(uuidV7Pattern)
            expect(initialPageview.properties.$cookieless_mode).toEqual(undefined)
            expect(document.cookie).toContain('distinct_id')
            expect(posthog.sessionRecording).toBeTruthy()

            // Verify surveys are reinitialized after opt in
            expect(mockSurveysLoadIfEnabled).toHaveBeenCalled()
        })

        it('should not send any events before opt out, then send cookieless events', async () => {
            expect(document.cookie).toEqual('')

            const { posthog, beforeSendMock } = await setup({
                cookieless_mode: 'on_reject',
            })
            posthog.capture('eventBeforeOptOut') // will be dropped
            expect(beforeSendMock).toBeCalledTimes(0)
            expect(posthog.has_opted_out_capturing()).toEqual(true)

            // opt out
            posthog.opt_out_capturing()

            posthog.capture('eventAfterOptOut')

            expect(beforeSendMock).toBeCalledTimes(2)
            const pageview = beforeSendMock.mock.calls[0][0]
            expect(pageview.event).toBe('$pageview') // initial pageview

            const event = beforeSendMock.mock.calls[1][0]
            expect(event.event).toBe('eventAfterOptOut')
            expect(event.properties.distinct_id).toEqual('$posthog_cookieless')
            expect(event.properties.$anon_distinct_id).toEqual(undefined)
            expect(event.properties.$device_id).toBe(null)
            expect(event.properties.$session_id).toBe(undefined)
            expect(event.properties.$window_id).toBe(undefined)
            expect(event.properties.$cookieless_mode).toEqual(true)
            expect(document.cookie).toEqual('') // Q: why isn't consent set here? A: it's stored in localStorage
            expect(posthog.sessionRecording).toBeFalsy()
        })

        it('should pick up positive cookie consent on startup and start sending non-cookieless events', async () => {
            const persistenceName = uuidv7()
            const { posthog: previousPosthog } = await setup(
                {
                    cookieless_mode: 'on_reject',
                    consent_persistence_name: persistenceName,
                    persistence_name: persistenceName,
                },
                undefined
            )
            previousPosthog.opt_in_capturing()
            const { beforeSendMock, posthog } = await setup(
                {
                    cookieless_mode: 'on_reject',
                    consent_persistence_name: persistenceName,
                    persistence_name: persistenceName,
                },
                undefined
            )
            posthog.capture('eventWithStoredCookieConsentConfirm')
            expect(beforeSendMock).toBeCalledTimes(1)
            const event = beforeSendMock.mock.calls[0][0]
            expect(event.event).toBe('eventWithStoredCookieConsentConfirm')
            expect(event.properties.distinct_id).toMatch(uuidV7Pattern)
            expect(event.properties.$anon_distinct_id).toBe(undefined)
            expect(event.properties.$device_id).toMatch(uuidV7Pattern)
            expect(event.properties.$session_id).toMatch(uuidV7Pattern)
            expect(event.properties.$window_id).toMatch(uuidV7Pattern)
            expect(event.properties.$cookieless_mode).toEqual(undefined)
            expect(posthog.sessionRecording).toBeTruthy()
        })

        it('should pick up negative cookie consent on startup and start sending cookieless events', async () => {
            const persistenceName = uuidv7()
            const { posthog: previousPosthog } = await setup(
                {
                    cookieless_mode: 'on_reject',
                    consent_persistence_name: persistenceName,
                    persistence_name: persistenceName,
                },
                undefined
            )
            previousPosthog.opt_out_capturing()
            const { beforeSendMock, posthog } = await setup(
                {
                    cookieless_mode: 'on_reject',
                    consent_persistence_name: persistenceName,
                    persistence_name: persistenceName,
                },
                undefined
            )
            posthog.capture('eventWithStoredCookieConsentConfirm')
            expect(beforeSendMock).toBeCalledTimes(1)
            const event = beforeSendMock.mock.calls[0][0]
            expect(event.event).toBe('eventWithStoredCookieConsentConfirm')
            expect(event.properties.distinct_id).toEqual('$posthog_cookieless')
            expect(event.properties.$anon_distinct_id).toEqual(undefined)
            expect(event.properties.$device_id).toBe(null)
            expect(event.properties.$session_id).toBe(undefined)
            expect(event.properties.$window_id).toBe(undefined)
            expect(event.properties.$cookieless_mode).toEqual(true)
            expect(posthog.sessionRecording).toBeFalsy()
        })

        it('should reset when switching consent mode from opt out to opt in', async () => {
            const { posthog, beforeSendMock } = await setup({
                cookieless_mode: 'on_reject',
            })
            posthog.opt_out_capturing()
            posthog.register({ test: 'test' })
            posthog.capture(eventName, eventProperties)
            expect(beforeSendMock).toBeCalledTimes(2)
            expect(beforeSendMock.mock.calls[1][0].properties.test).toBe('test')

            posthog.opt_in_capturing()
            posthog.capture(eventName, eventProperties)

            expect(beforeSendMock).toBeCalledTimes(4)
            expect(beforeSendMock.mock.calls[2][0].event).toBe('$opt_in')
            expect(beforeSendMock.mock.calls[2][0].properties.test).toBe(undefined)
            expect(beforeSendMock.mock.calls[3][0].event).toBe(eventName)
            expect(beforeSendMock.mock.calls[3][0].properties.test).toBe(undefined)
            expect(beforeSendMock.mock.calls[3][0].properties.distinct_id).toMatch(uuidV7Pattern)
            expect(beforeSendMock.mock.calls[3][0].properties.$anon_distinct_id).toBe(undefined)
            expect(beforeSendMock.mock.calls[3][0].properties.$device_id).toMatch(uuidV7Pattern)
            expect(beforeSendMock.mock.calls[3][0].properties.$session_id).toMatch(uuidV7Pattern)
            expect(beforeSendMock.mock.calls[3][0].properties.$window_id).toMatch(uuidV7Pattern)
            expect(beforeSendMock.mock.calls[3][0].properties.$cookieless_mode).toEqual(undefined)
            expect(posthog.sessionRecording).toBeTruthy()
        })

        it('should reset when switching consent mode from opt in to opt out', async () => {
            const { posthog, beforeSendMock } = await setup({
                cookieless_mode: 'on_reject',
            })
            posthog.opt_in_capturing()
            posthog.register({ test: 'test' })
            posthog.capture(eventName, eventProperties)

            expect(beforeSendMock).toBeCalledTimes(3)
            expect(beforeSendMock.mock.calls[2][0].properties.test).toBe('test')

            posthog.opt_out_capturing()
            posthog.capture(eventName, eventProperties)

            expect(beforeSendMock).toBeCalledTimes(4)
            expect(beforeSendMock.mock.calls[3][0].event).toBe(eventName)
            expect(beforeSendMock.mock.calls[3][0].properties.test).toBe(undefined)
            expect(beforeSendMock.mock.calls[3][0].properties.distinct_id).toEqual('$posthog_cookieless')
            expect(beforeSendMock.mock.calls[3][0].properties.$anon_distinct_id).toEqual(undefined)
            expect(beforeSendMock.mock.calls[3][0].properties.$device_id).toBe(null)
            expect(beforeSendMock.mock.calls[3][0].properties.$session_id).toBe(undefined)
            expect(beforeSendMock.mock.calls[3][0].properties.$window_id).toBe(undefined)
            expect(beforeSendMock.mock.calls[3][0].properties.$cookieless_mode).toEqual(true)
            expect(posthog.sessionRecording).toBeFalsy()
        })

        it('should restart the request queue when opting in', async () => {
            // we're testing the interaction with the request queue, so we need to mock fetch rather than relying on before_send
            jest.useFakeTimers()
            const { posthog } = await setup({
                cookieless_mode: 'on_reject',
                request_batching: true,
            })
            expect(mockedFetch).toBeCalledTimes(1) // flags
            expect(mockedFetch.mock.calls[0][0]).toContain('/flags/')

            posthog.opt_in_capturing()
            expect(mockedFetch).toBeCalledTimes(3) // flags + opt in + pageview
            expect(JSON.parse(mockedFetch.mock.calls[1][1].body).event).toEqual('$opt_in')
            expect(JSON.parse(mockedFetch.mock.calls[2][1].body).event).toEqual('$pageview')

            posthog.capture('custom event')
            jest.runOnlyPendingTimers() // allows the batch queue to flush
            expect(mockedFetch).toBeCalledTimes(4) // flags + opt in + pageview + custom event
            expect(JSON.parse(mockedFetch.mock.calls[3][1].body)[0].event).toEqual('custom event')
        })
    })
})
