import type { PostHogConfig } from '../types'
import { uuidv7 } from '../uuidv7'
import { createPosthogInstance } from './helpers/posthog-instance'
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

jest.mock('../utils/globals', () => {
    const orig = jest.requireActual('../utils/globals')
    const mockURLGetter = jest.fn()
    const mockReferrerGetter = jest.fn()
    const mockedCookieBox = { cookie: '' }
    return {
        ...orig,
        mockURLGetter,
        mockReferrerGetter,
        mockedCookieBox: mockedCookieBox,
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
    }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mockURLGetter, mockedCookieBox, document } = require('../utils/globals')

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
    })

    describe('always mode', () => {
        it('should not set any cookies', async () => {
            const { posthog, beforeSendMock } = await setup({
                cookieless_mode: 'always',
            })
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

            // should ignore cookie consent, and throw in test code due to logging an error
            expect(() => posthog.opt_in_capturing()).toThrow()
        })
    })

    describe('on_reject mode', () => {
        it('should not send any events before opt in, then send non-cookieless events', async () => {
            const { posthog, beforeSendMock } = await setup({
                cookieless_mode: 'on_reject',
            })
            posthog.capture('eventBeforeOptIn') // will be dropped
            expect(beforeSendMock).toBeCalledTimes(0)

            // opt in
            posthog.opt_in_capturing()

            expect(beforeSendMock).toBeCalledTimes(2)
            const optInEvent = beforeSendMock.mock.calls[0][0]
            expect(optInEvent.event).toBe('$opt_in')

            const eventBeforeOptIn = beforeSendMock.mock.calls[1][0]
            expect(eventBeforeOptIn.event).toBe('$pageview') // initial pageview
            expect(eventBeforeOptIn.properties.distinct_id).toMatch(uuidV7Pattern)
            expect(eventBeforeOptIn.properties.$anon_distinct_id).toBe(undefined)
            expect(eventBeforeOptIn.properties.$device_id).toMatch(uuidV7Pattern)
            expect(eventBeforeOptIn.properties.$session_id).toMatch(uuidV7Pattern)
            expect(eventBeforeOptIn.properties.$window_id).toMatch(uuidV7Pattern)
            expect(eventBeforeOptIn.properties.$cookieless_mode).toEqual(undefined)
            expect(document.cookie).toContain('distinct_id')
        })

        it('should not send any events before opt out, then send cookieless events', async () => {
            expect(document.cookie).toEqual('')

            const { posthog, beforeSendMock } = await setup({
                cookieless_mode: 'on_reject',
            })
            posthog.capture('eventBeforeOptOut') // will be dropped
            expect(beforeSendMock).toBeCalledTimes(0)

            // opt out
            posthog.opt_out_capturing()

            posthog.capture('eventAfterOptOut')

            expect(beforeSendMock).toBeCalledTimes(2)
            const pageview = beforeSendMock.mock.calls[0][0]
            expect(pageview.event).toBe('$pageview') // initial pageview

            const eventBeforeOptIn = beforeSendMock.mock.calls[1][0]
            expect(eventBeforeOptIn.event).toBe('eventAfterOptOut')
            expect(eventBeforeOptIn.properties.distinct_id).toEqual('$posthog_cookieless')
            expect(eventBeforeOptIn.properties.$anon_distinct_id).toEqual(undefined)
            expect(eventBeforeOptIn.properties.$device_id).toBe(null)
            expect(eventBeforeOptIn.properties.$session_id).toBe(undefined)
            expect(eventBeforeOptIn.properties.$window_id).toBe(undefined)
            expect(eventBeforeOptIn.properties.$cookieless_mode).toEqual(true)
            expect(document.cookie).toEqual('') // Q: why isn't consent set here? A: it's stored in localStorage
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
            const pageview = beforeSendMock.mock.calls[0][0]
            expect(pageview.event).toBe('eventWithStoredCookieConsentConfirm')
            expect(pageview.properties.distinct_id).toMatch(uuidV7Pattern)
            expect(pageview.properties.$anon_distinct_id).toBe(undefined)
            expect(pageview.properties.$device_id).toMatch(uuidV7Pattern)
            expect(pageview.properties.$session_id).toMatch(uuidV7Pattern)
            expect(pageview.properties.$window_id).toMatch(uuidV7Pattern)
            expect(pageview.properties.$cookieless_mode).toEqual(undefined)
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
            const pageview = beforeSendMock.mock.calls[0][0]
            expect(pageview.event).toBe('eventWithStoredCookieConsentConfirm')
            expect(pageview.properties.distinct_id).toEqual('$posthog_cookieless')
            expect(pageview.properties.$anon_distinct_id).toEqual(undefined)
            expect(pageview.properties.$device_id).toBe(null)
            expect(pageview.properties.$session_id).toBe(undefined)
            expect(pageview.properties.$window_id).toBe(undefined)
            expect(pageview.properties.$cookieless_mode).toEqual(true)
        })
    })
})
