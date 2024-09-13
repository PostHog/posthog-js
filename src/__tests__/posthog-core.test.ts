import { defaultPostHog } from './helpers/posthog-instance'
import type { PostHogConfig } from '../types'
import { uuidv7 } from '../uuidv7'

const mockReferrerGetter = jest.fn()
const mockURLGetter = jest.fn()
jest.mock('../utils/globals', () => {
    const orig = jest.requireActual('../utils/globals')
    return {
        ...orig,
        document: {
            ...orig.document,
            createElement: (...args: any[]) => orig.document.createElement(...args),
            get referrer() {
                return mockReferrerGetter?.()
            },
            get URL() {
                return mockURLGetter?.()
            },
        },
        get location() {
            const url = mockURLGetter?.()
            return {
                href: url,
                toString: () => url,
            }
        },
    }
})

describe('posthog core', () => {
    beforeEach(() => {
        mockReferrerGetter.mockReturnValue('https://referrer.com')
        mockURLGetter.mockReturnValue('https://example.com')
        console.error = jest.fn()
    })

    it('exposes the version', () => {
        expect(defaultPostHog().version).toMatch(/\d+\.\d+\.\d+/)
    })

    describe('capture()', () => {
        const eventName = 'custom_event'
        const eventProperties = {
            event: 'prop',
        }
        const setup = (config: Partial<PostHogConfig> = {}, token: string = uuidv7()) => {
            const onCapture = jest.fn()
            const posthog = defaultPostHog().init(token, { ...config, _onCapture: onCapture }, token)!
            posthog.debug()
            return { posthog, onCapture }
        }

        it('respects property_denylist and property_blacklist', () => {
            // arrange
            const { posthog } = setup({
                property_denylist: ['$lib', 'persistent', '$is_identified'],
                property_blacklist: ['token'],
            })

            // act
            const actual = posthog._calculate_event_properties(eventName, eventProperties, new Date())

            // assert
            expect(actual['event']).toBe('prop')
            expect(actual['$lib']).toBeUndefined()
            expect(actual['persistent']).toBeUndefined()
            expect(actual['$is_identified']).toBeUndefined()
            expect(actual['token']).toBeUndefined()
        })

        describe('rate limiting', () => {
            it('includes information about remaining rate limit', () => {
                const { posthog, onCapture } = setup()

                posthog.capture(eventName, eventProperties)

                expect(onCapture.mock.calls[0][1]).toMatchObject({
                    properties: {
                        $lib_rate_limit_remaining_tokens: 99,
                    },
                })
            })

            it('does not capture if rate limit is in place', () => {
                jest.useFakeTimers()
                jest.setSystemTime(Date.now())

                console.error = jest.fn()
                const { posthog, onCapture } = setup()
                for (let i = 0; i < 100; i++) {
                    posthog.capture(eventName, eventProperties)
                }
                expect(onCapture).toHaveBeenCalledTimes(100)
                onCapture.mockClear()
                ;(console.error as any).mockClear()
                for (let i = 0; i < 50; i++) {
                    posthog.capture(eventName, eventProperties)
                }
                expect(onCapture).toHaveBeenCalledTimes(1)
                expect(onCapture.mock.calls[0][0]).toBe('$$client_ingestion_warning')
                expect(console.error).toHaveBeenCalledTimes(50)
                expect(console.error).toHaveBeenCalledWith(
                    '[PostHog.js]',
                    'This capture call is ignored due to client rate limiting.'
                )
            })
        })

        describe('referrer', () => {
            it("should send referrer info with the event's properties", () => {
                // arrange
                const token = uuidv7()
                mockReferrerGetter.mockReturnValue('https://referrer.example.com/some/path')
                const { posthog, onCapture } = setup({
                    token,
                    persistence_name: token,
                })

                // act
                posthog.capture(eventName, eventProperties)

                // assert
                const { $set_once, properties } = onCapture.mock.calls[0][1]
                expect($set_once['$initial_referrer']).toBe('https://referrer.example.com/some/path')
                expect($set_once['$initial_referring_domain']).toBe('referrer.example.com')
                expect(properties['$referrer']).toBe('https://referrer.example.com/some/path')
                expect(properties['$referring_domain']).toBe('referrer.example.com')
            })

            it('should not update the referrer within the same session', () => {
                // arrange
                const token = uuidv7()
                mockReferrerGetter.mockReturnValue('https://referrer1.example.com/some/path')
                const { posthog: posthog1 } = setup({
                    token,
                    persistence_name: token,
                })
                posthog1.capture(eventName, eventProperties)
                mockReferrerGetter.mockReturnValue('https://referrer2.example.com/some/path')
                const { posthog: posthog2, onCapture: onCapture2 } = setup({
                    token,
                    persistence_name: token,
                })

                // act
                posthog2.capture(eventName, eventProperties)

                // assert
                expect(posthog2.persistence!.props.$initial_person_info.r).toEqual(
                    'https://referrer1.example.com/some/path'
                )
                expect(posthog2.sessionPersistence!.props.$referrer).toEqual('https://referrer1.example.com/some/path')
                const { $set_once, properties } = onCapture2.mock.calls[0][1]
                expect($set_once['$initial_referrer']).toBe('https://referrer1.example.com/some/path')
                expect($set_once['$initial_referring_domain']).toBe('referrer1.example.com')
                expect(properties['$referrer']).toBe('https://referrer1.example.com/some/path')
                expect(properties['$referring_domain']).toBe('referrer1.example.com')
            })

            it('should use the new referrer in a new session', () => {
                // arrange
                const token = uuidv7()
                mockReferrerGetter.mockReturnValue('https://referrer1.example.com/some/path')
                const { posthog: posthog1 } = setup({
                    token,
                    persistence_name: token,
                })
                posthog1.capture(eventName, eventProperties)
                mockReferrerGetter.mockReturnValue('https://referrer2.example.com/some/path')
                const { posthog: posthog2, onCapture: onCapture2 } = setup({
                    token,
                    persistence_name: token,
                })
                posthog2.sessionPersistence!.clear() // simulate a new session

                // act
                posthog2.capture(eventName, eventProperties)

                // assert
                expect(posthog2.persistence!.props.$initial_person_info.r).toEqual(
                    'https://referrer1.example.com/some/path'
                )
                const { $set_once, properties } = onCapture2.mock.calls[0][1]
                expect($set_once['$initial_referrer']).toBe('https://referrer1.example.com/some/path')
                expect($set_once['$initial_referring_domain']).toBe('referrer1.example.com')
                expect(properties['$referrer']).toBe('https://referrer2.example.com/some/path')
                expect(properties['$referring_domain']).toBe('referrer2.example.com')
            })

            it('should use $direct when there is no referrer', () => {
                // arrange
                const token = uuidv7()
                mockReferrerGetter.mockReturnValue('')
                const { posthog, onCapture } = setup({
                    token,
                    persistence_name: token,
                })

                // act
                posthog.capture(eventName, eventProperties)

                // assert
                const { $set_once, properties } = onCapture.mock.calls[0][1]
                expect($set_once['$initial_referrer']).toBe('$direct')
                expect($set_once['$initial_referring_domain']).toBe('$direct')
                expect(properties['$referrer']).toBe('$direct')
                expect(properties['$referring_domain']).toBe('$direct')
            })
        })
    })
})
