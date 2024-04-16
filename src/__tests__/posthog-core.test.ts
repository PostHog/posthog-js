import _posthog, { PostHogConfig } from '../loaders/loader-module'
import { uuidv7 } from '../uuidv7'

describe('posthog core', () => {
    describe('capture()', () => {
        const eventName = 'custom_event'
        const properties = {
            event: 'prop',
        }
        const setup = (config: Partial<PostHogConfig>) => {
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
    })
})
