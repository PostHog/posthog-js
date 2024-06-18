import _posthog, { PostHog, PostHogConfig } from '../loader-module'
import { uuidv7 } from '../uuidv7'

import { isNull } from '../utils/type-utils'
import { document, assignableWindow, navigator } from '../utils/globals'

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

describe('consentManager', () => {
    const createPostHog = (config: Partial<PostHogConfig> = {}) => {
        const posthog = _posthog.init('testtoken', { ...config }, uuidv7())!
        posthog.debug()
        return posthog
    }

    let posthog: PostHog

    beforeEach(() => {
        posthog = createPostHog()
        posthog.reset()
    })

    afterEach(() => {
        document!.getElementsByTagName('html')[0].innerHTML = ''
        assignableWindow.localStorage.clear()
        deleteAllCookies()
    })

    it('should start default opted in', () => {
        expect(posthog.has_opted_in_capturing()).toBe(true)
        expect(posthog.has_opted_out_capturing()).toBe(false)

        expect(posthog.persistence?.disabled).toBe(false)
        expect(posthog.sessionPersistence?.disabled).toBe(false)
    })

    it('should start default opted out if setting given', () => {
        posthog = createPostHog({ opt_out_capturing_by_default: true })
        expect(posthog.has_opted_in_capturing()).toBe(false)
        expect(posthog.has_opted_out_capturing()).toBe(true)

        expect(posthog.persistence?.disabled).toBe(false)
        expect(posthog.sessionPersistence?.disabled).toBe(false)
    })

    it('should start default opted out if setting given and disable storage', () => {
        posthog = createPostHog({ opt_out_capturing_by_default: true, opt_out_persistence_by_default: true })
        expect(posthog.has_opted_in_capturing()).toBe(false)
        expect(posthog.has_opted_out_capturing()).toBe(true)

        expect(posthog.persistence?.disabled).toBe(true)
        expect(posthog.sessionPersistence?.disabled).toBe(true)
    })

    it('should enable or disable persistence when changing opt out status', () => {
        posthog = createPostHog({ opt_out_capturing_by_default: true, opt_out_persistence_by_default: true })
        expect(posthog.has_opted_in_capturing()).toBe(false)
        expect(posthog.persistence?.disabled).toBe(true)

        posthog.opt_in_capturing()
        expect(posthog.has_opted_in_capturing()).toBe(true)
        expect(posthog.persistence?.disabled).toBe(false)

        posthog.opt_out_capturing()
        expect(posthog.has_opted_in_capturing()).toBe(false)
        expect(posthog.persistence?.disabled).toBe(true)
    })

    it('should send opt in event if not disabled', () => {
        const onCapture = jest.fn()
        posthog = createPostHog({ opt_out_capturing_by_default: true, _onCapture: onCapture })
        posthog.opt_in_capturing()
        expect(onCapture).toHaveBeenCalledWith('$opt_in', expect.objectContaining({}))
        onCapture.mockClear()

        posthog.opt_in_capturing({
            captureEventName: 'override-opt-in',
            captureProperties: {
                foo: 'bar',
            },
        })
        expect(onCapture).toHaveBeenCalledWith(
            'override-opt-in',
            expect.objectContaining({
                properties: expect.objectContaining({
                    foo: 'bar',
                }),
            })
        )
        onCapture.mockClear()
        posthog.opt_in_capturing({ captureEventName: null })
        expect(onCapture).not.toHaveBeenCalled()
        posthog.opt_in_capturing({ captureEventName: false })
        expect(onCapture).not.toHaveBeenCalled()
    })

    describe('with do not track setting', () => {
        beforeEach(() => {
            ;(navigator as any).doNotTrack = '1'
        })

        it('should respect it if explicitly set', () => {
            posthog = createPostHog({ respect_dnt: true })
            expect(posthog.has_opted_in_capturing()).toBe(false)
        })

        it('should not respect it if not explicitly set', () => {
            expect(posthog.has_opted_in_capturing()).toBe(true)
        })
    })

    describe.each([`cookie`, `localStorage`] as PostHogConfig['opt_out_capturing_persistence_type'][])(
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

            beforeEach(() => {
                posthog = createPostHog({
                    opt_out_capturing_persistence_type: persistenceType,
                    persistence: persistenceType,
                })
            })

            describe(`common consent functions`, () => {
                it(`should set a persistent value marking the user as opted-in for a given token`, () => {
                    posthog.opt_in_capturing()
                    assertPersistenceValue(1)
                })

                it(`should set a persistent value marking the user as opted-out for a given token`, () => {
                    posthog.opt_out_capturing()
                    assertPersistenceValue(0)
                })

                it(`should capture an event recording the opt-in action`, () => {
                    const onCapture = jest.fn()
                    posthog.on('eventCaptured', onCapture)

                    posthog.opt_in_capturing()
                    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ event: '$opt_in' }))

                    onCapture.mockClear()
                    const captureEventName = `єνєηт`
                    const captureProperties = { '𝖕𝖗𝖔𝖕𝖊𝖗𝖙𝖞': `𝓿𝓪𝓵𝓾𝓮` }

                    posthog.opt_in_capturing({ captureEventName, captureProperties })
                    expect(onCapture).toHaveBeenCalledWith(
                        expect.objectContaining({
                            event: captureEventName,
                            properties: expect.objectContaining(captureProperties),
                        })
                    )
                })

                it(`should allow use of a custom "persistence prefix" string (with correct default behavior)`, () => {
                    posthog = createPostHog({
                        opt_out_capturing_persistence_type: persistenceType,
                        opt_out_capturing_cookie_prefix: CUSTOM_PERSISTENCE_PREFIX,
                    })
                    posthog.opt_out_capturing()
                    posthog.opt_in_capturing()

                    assertPersistenceValue(null)
                    assertPersistenceValue(1, CUSTOM_PERSISTENCE_PREFIX)

                    posthog.opt_out_capturing()

                    assertPersistenceValue(null)
                    assertPersistenceValue(0, CUSTOM_PERSISTENCE_PREFIX)
                })

                it(`should clear the persisted value`, () => {
                    posthog.opt_in_capturing()
                    assertPersistenceValue(1)
                    posthog.reset()
                    assertPersistenceValue(null)
                })
            })
        }
    )
})
