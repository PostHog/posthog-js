import _posthog, { PostHog, PostHogConfig } from '../loader-module'
import { uuidv7 } from '../uuidv7'

describe('posthog core', () => {
    const createPostHog = (config: Partial<PostHogConfig> = {}): PostHog => {
        const posthog = _posthog.init('testtoken', { ...config, persistence_name: uuidv7() }, uuidv7())!
        posthog.debug()
        return posthog
    }

    let posthog: PostHog

    beforeEach(() => {
        posthog = createPostHog()
    })

    describe('capture()', () => {
        const eventName = 'custom_event'
        const properties = {
            event: 'prop',
        }

        it('respects property_denylist and property_blacklist', () => {
            posthog = createPostHog({
                property_denylist: ['$lib', 'persistent', '$is_identified'],
                property_blacklist: ['token'],
            })

            const actual = posthog._calculate_event_properties(eventName, properties)

            expect(actual['event']).toBe('prop')
            expect(actual['$lib']).toBeUndefined()
            expect(actual['persistent']).toBeUndefined()
            expect(actual['$is_identified']).toBeUndefined()
            expect(actual['token']).toBeUndefined()
        })

        describe('rate limiting', () => {
            const onCapture = jest.fn()
            beforeEach(() => {
                onCapture.mockClear()
                posthog = createPostHog({ _onCapture: onCapture })
            })

            it('includes information about remaining rate limit', () => {
                posthog.capture(eventName, properties)

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

                for (let i = 0; i < 100; i++) {
                    posthog.capture(eventName, properties)
                }
                expect(onCapture).toHaveBeenCalledTimes(100)
                onCapture.mockClear()
                ;(console.error as any).mockClear()
                posthog.capture(eventName, properties)
                expect(onCapture).toHaveBeenCalledTimes(0)
                expect(console.error).toHaveBeenCalledTimes(1)
                expect(console.error).toHaveBeenCalledWith(
                    '[PostHog.js]',
                    'This capture call is ignored due to client rate limiting.'
                )
            })
        })
    })

    describe('flush', () => {
        it('flushes the queue', () => {
            posthog.capture('event1')
            posthog.capture('event2')
            posthog.capture('event3')

            expect(posthog._requestQueue?.['queue']).toHaveLength(3)
        })
    })
})
