import './helpers/mock-logger'

import { PostHog } from '../posthog-core'
import { defaultPostHog } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'

import { isNull } from '@posthog/core'
import { document, assignableWindow, navigator } from '../utils/globals'
import { PostHogConfig } from '../types'

const DEFAULT_PERSISTENCE_PREFIX = `__ph_opt_in_out_`
const CUSTOM_PERSISTENCE_PREFIX = `𝓶𝓶𝓶𝓬𝓸𝓸𝓴𝓲𝓮𝓼`

function deleteAllCookies() {
    const cookies = document!.cookie.split(';')

    for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i]
        const eqPos = cookie.indexOf('=')
        const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie
        document!.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT'
    }
}

// periodically flakes because of unexpected console logging
jest.retryTimes(3)

describe('consentManager', () => {
    const createPostHog = async (config: Partial<PostHogConfig> = {}) => {
        const posthog = await new Promise<PostHog>(
            (resolve) =>
                defaultPostHog().init('testtoken', { ...config, loaded: (posthog) => resolve(posthog) }, uuidv7())!
        )
        posthog.debug()
        return posthog
    }

    let posthog: PostHog

    beforeEach(async () => {
        posthog = await createPostHog()
        posthog.reset()

        // we don't want unexpected console errors/warnings to fail these tests
        console.error = jest.fn()
        console.warn = jest.fn()
    })

    afterEach(() => {
        document!.getElementsByTagName('html')[0].innerHTML = ''
        assignableWindow.localStorage.clear()
        deleteAllCookies()
    })

    it('should start default opted in', () => {
        expect(posthog.hasOptedInCapturing()).toBe(true)
        expect(posthog.hasOptedOutCapturing()).toBe(false)
        expect(posthog.getExplicitConsentStatus()).toBe('pending')

        expect(posthog.persistence?._disabled).toBe(false)
        expect(posthog.sessionPersistence?._disabled).toBe(false)
    })

    it('should start default opted out if setting given', async () => {
        posthog = await createPostHog({ optOutCapturingByDefault: true })
        expect(posthog.hasOptedInCapturing()).toBe(false)
        expect(posthog.hasOptedOutCapturing()).toBe(true)
        expect(posthog.getExplicitConsentStatus()).toBe('pending')

        expect(posthog.persistence?._disabled).toBe(false)
        expect(posthog.sessionPersistence?._disabled).toBe(false)
    })

    it('should start default opted out if setting given and disable storage', async () => {
        posthog = await createPostHog({ optOutCapturingByDefault: true, optOutPersistenceByDefault: true })
        expect(posthog.hasOptedInCapturing()).toBe(false)
        expect(posthog.hasOptedOutCapturing()).toBe(true)
        expect(posthog.getExplicitConsentStatus()).toBe('pending')

        expect(posthog.persistence?._disabled).toBe(true)
        expect(posthog.sessionPersistence?._disabled).toBe(true)
    })

    it('should enable or disable persistence when changing opt out status', async () => {
        posthog = await createPostHog({ optOutCapturingByDefault: true, optOutPersistenceByDefault: true })
        expect(posthog.hasOptedInCapturing()).toBe(false)
        expect(posthog.persistence?._disabled).toBe(true)
        expect(posthog.getExplicitConsentStatus()).toBe('pending')

        posthog.optInCapturing()
        expect(posthog.hasOptedInCapturing()).toBe(true)
        expect(posthog.persistence?._disabled).toBe(false)
        expect(posthog.getExplicitConsentStatus()).toBe('granted')

        posthog.optOutCapturing()
        expect(posthog.hasOptedInCapturing()).toBe(false)
        expect(posthog.persistence?._disabled).toBe(true)
        expect(posthog.getExplicitConsentStatus()).toBe('denied')
    })

    describe('opt out event', () => {
        let beforeSendMock = jest.fn().mockImplementation((...args) => args)
        beforeEach(async () => {
            beforeSendMock = jest.fn().mockImplementation((e) => e)
            posthog = await createPostHog({ optOutCapturingByDefault: true, beforeSend: beforeSendMock })
        })

        it('should send opt in event if not disabled', () => {
            posthog.optInCapturing()
            expect(beforeSendMock).toHaveBeenCalledWith(expect.objectContaining({ event: '$opt_in' }))
        })

        it('should send opt in event with overrides', () => {
            posthog.optInCapturing({
                captureEventName: 'override-opt-in',
                captureProperties: {
                    foo: 'bar',
                },
            })
            expect(beforeSendMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'override-opt-in',
                    properties: expect.objectContaining({
                        foo: 'bar',
                    }),
                })
            )
        })

        it('should not send opt in event if false', () => {
            posthog.optInCapturing({ captureEventName: false })
            expect(beforeSendMock).toHaveBeenCalledTimes(1)
            expect(beforeSendMock).not.toHaveBeenCalledWith(expect.objectContaining({ event: '$opt_in' }))
            expect(beforeSendMock).lastCalledWith(expect.objectContaining({ event: '$pageview' }))
        })

        it('should not send opt in event if false', () => {
            posthog.optInCapturing({ captureEventName: false })
            expect(beforeSendMock).toHaveBeenCalledTimes(1)
            expect(beforeSendMock).not.toHaveBeenCalledWith(expect.objectContaining({ event: '$opt_in' }))
            expect(beforeSendMock).lastCalledWith(expect.objectContaining({ event: '$pageview' }))
        })

        it('should not send $pageview on opt in if capturing is disabled', async () => {
            posthog = await createPostHog({
                optOutCapturingByDefault: true,
                beforeSend: beforeSendMock,
                capturePageview: false,
            })
            posthog.optInCapturing({ captureEventName: false })
            expect(beforeSendMock).toHaveBeenCalledTimes(0)
        })

        it('should not send $pageview on opt in if is has already been captured', async () => {
            posthog = await createPostHog({
                beforeSend: beforeSendMock,
            })
            // Wait for the initial $pageview to be captured
            // eslint-disable-next-line compat/compat
            await new Promise((r) => setTimeout(r, 10))
            expect(beforeSendMock).toHaveBeenCalledTimes(1)
            expect(beforeSendMock).lastCalledWith(expect.objectContaining({ event: '$pageview' }))
            posthog.optInCapturing()
            expect(beforeSendMock).toHaveBeenCalledTimes(2)
            expect(beforeSendMock).toHaveBeenCalledWith(expect.objectContaining({ event: '$opt_in' }))
        })

        it('should send $pageview on opt in if is has not been captured', async () => {
            // Some other tests might call setTimeout after they've passed, so creating a new instance here.
            const beforeSendMock = jest.fn().mockImplementation((e) => e)
            const posthog = await createPostHog({ beforeSend: beforeSendMock })

            posthog.optInCapturing()
            expect(beforeSendMock).toHaveBeenCalledTimes(2)
            expect(beforeSendMock).toHaveBeenCalledWith(expect.objectContaining({ event: '$opt_in' }))
            expect(beforeSendMock).lastCalledWith(expect.objectContaining({ event: '$pageview' }))
            // Wait for the $pageview timeout to be called
            // eslint-disable-next-line compat/compat
            await new Promise((r) => setTimeout(r, 10))
            expect(beforeSendMock).toHaveBeenCalledTimes(2)
        })

        it('should not send $pageview on subsequent opt in', async () => {
            // Some other tests might call setTimeout after they've passed, so creating a new instance here.
            const beforeSendMock = jest.fn().mockImplementation((e) => e)
            const posthog = await createPostHog({ beforeSend: beforeSendMock })

            posthog.optInCapturing()
            expect(beforeSendMock).toHaveBeenCalledTimes(2)
            expect(beforeSendMock).toHaveBeenCalledWith(expect.objectContaining({ event: '$opt_in' }))
            expect(beforeSendMock).lastCalledWith(expect.objectContaining({ event: '$pageview' }))
            // Wait for the $pageview timeout to be called
            // eslint-disable-next-line compat/compat
            await new Promise((r) => setTimeout(r, 10))
            posthog.optInCapturing()
            expect(beforeSendMock).toHaveBeenCalledTimes(3)
            expect(beforeSendMock).not.lastCalledWith(expect.objectContaining({ event: '$pageview' }))
        })
    })

    describe('with do not track setting', () => {
        beforeEach(() => {
            ;(navigator as any).doNotTrack = '1'
        })

        it('should respect it if explicitly set', async () => {
            posthog = await createPostHog({ respectDnt: true })
            expect(posthog.hasOptedInCapturing()).toBe(false)
        })

        it('should not respect it if not explicitly set', () => {
            expect(posthog.hasOptedInCapturing()).toBe(true)
        })
    })

    describe.each([`cookie`, `localStorage`] as PostHogConfig['optOutCapturingPersistenceType'][])(
        `%s`,
        (persistenceType) => {
            function assertPersistenceValue(
                value: string | number | null,
                persistencePrefix = DEFAULT_PERSISTENCE_PREFIX
            ) {
                const token = posthog.config.token
                const expected = persistencePrefix + token
                if (persistenceType === `cookie`) {
                    if (isNull(value)) {
                        expect(document!.cookie).not.toContain(expected + `=`)
                    } else {
                        expect(document!.cookie).toContain(expected + `=${value}`)
                    }
                } else {
                    if (isNull(value)) {
                        expect(assignableWindow.localStorage.getItem(expected)).toBeNull()
                    } else {
                        expect(assignableWindow.localStorage.getItem(expected)).toBe(`${value}`)
                    }
                }
            }

            beforeEach(async () => {
                posthog = await createPostHog({
                    optOutCapturingPersistenceType: persistenceType,
                    persistence: persistenceType,
                })
            })

            describe(`common consent functions`, () => {
                it(`should set a persistent value marking the user as opted-in for a given token`, () => {
                    posthog.optInCapturing()
                    assertPersistenceValue(1)
                })

                it(`should set a persistent value marking the user as opted-out for a given token`, () => {
                    posthog.optOutCapturing()
                    assertPersistenceValue(0)
                })

                it(`should capture an event recording the opt-in action`, () => {
                    const beforeSendMock = jest.fn()
                    posthog.on('eventCaptured', beforeSendMock)

                    posthog.optInCapturing()
                    expect(beforeSendMock).toHaveBeenCalledWith(expect.objectContaining({ event: '$opt_in' }))

                    beforeSendMock.mockClear()
                    const captureEventName = `єνєηт`
                    const captureProperties = { '𝖕𝖗𝖔𝖕𝖊𝖗𝖙𝖞': `𝓿𝓪𝓵𝓾𝓮` }

                    posthog.optInCapturing({ captureEventName, captureProperties })
                    expect(beforeSendMock).toHaveBeenCalledWith(
                        expect.objectContaining({
                            event: captureEventName,
                            properties: expect.objectContaining(captureProperties),
                        })
                    )
                })

                it(`should allow use of a custom "persistence prefix" string (with correct default behavior)`, async () => {
                    posthog = await createPostHog({
                        optOutCapturingPersistenceType: persistenceType,
                        opt_out_capturing_cookie_prefix: CUSTOM_PERSISTENCE_PREFIX,
                    })
                    posthog.optOutCapturing()
                    posthog.optInCapturing()

                    assertPersistenceValue(null)
                    assertPersistenceValue(1, CUSTOM_PERSISTENCE_PREFIX)

                    posthog.optOutCapturing()

                    assertPersistenceValue(null)
                    assertPersistenceValue(0, CUSTOM_PERSISTENCE_PREFIX)
                })

                it(`should clear the persisted value`, () => {
                    posthog.optInCapturing()
                    assertPersistenceValue(1)
                    posthog.reset()
                    assertPersistenceValue(null)
                })
            })
        }
    )

    describe('consent storage cache invalidation', () => {
        it('should write consent to cookie when optOutCapturingPersistenceType is cookie, even if consent was accessed before init', async () => {
            // Simulate the bug: the primary instance's consent._storage is accessed
            // before init() is called (this happens in bundled apps where _dom_loaded()
            // fires during module load, before the user calls posthog.init()).
            const ph = new PostHog()

            // At this point, ph.config = defaultConfig() which has
            // optOutCapturingPersistenceType: 'localStorage'.
            // Trigger consent._storage initialization with the default config,
            // simulating what _dom_loaded() -> isCapturing() does.
            ph.consent.isOptedOut()

            // Now init on the SAME instance (no name = primary instance),
            // which is what users do: posthog.init(token, config)
            const token = uuidv7()
            await new Promise<void>((resolve) =>
                ph.init(token, {
                    optOutCapturingPersistenceType: 'cookie',
                    requestBatching: false,
                    apiHost: 'http://localhost',
                    loaded: () => resolve(),
                })
            )

            ph.optOutCapturing()

            const consentKey = DEFAULT_PERSISTENCE_PREFIX + token
            // Consent should be in the cookie, not just in localStorage
            expect(document!.cookie).toContain(consentKey + '=0')
        })
    })
})
