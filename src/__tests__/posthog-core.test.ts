import _posthog, { PostHogConfig } from '../loader-module'
import { uuidv7 } from '../uuidv7'

describe('posthog core', () => {
    describe('capture()', () => {
        const eventName = 'custom_event'
        const properties = {
            event: 'prop',
        }
        const setup = (config: Partial<PostHogConfig> = {}) => {
            const onCapture = jest.fn()
            const posthog = _posthog.init('testtoken', { ...config, _onCapture: onCapture }, uuidv7())!
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
            const actual = posthog._calculate_event_properties(eventName, properties)

            // assert
            expect(actual['event']).toBe('prop')
            expect(actual['$lib']).toBeUndefined()
            expect(actual['persistent']).toBeUndefined()
            expect(actual['$is_identified']).toBeUndefined()
            expect(actual['token']).toBeUndefined()
        })

        it('should capture stateless', () => {})

        describe('rate limiting', () => {
            it('includes information about remaining rate limit', () => {
                const { posthog, onCapture } = setup()

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
                const { posthog, onCapture } = setup()

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
})
