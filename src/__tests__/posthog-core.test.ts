import _posthog, { PostHog, PostHogConfig } from '../loader-module'
import { uuidv7 } from '../uuidv7'

describe('posthog core', () => {
    const createPostHog = (config: Partial<PostHogConfig> = {}): PostHog => {
        return _posthog.init(
            'testtoken',
            {
                persistence_name: uuidv7(),
                ...config,
            },
            uuidv7()
        )!
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

        const onCapture = jest.fn()

        beforeEach(() => {
            onCapture.mockClear()
            posthog = createPostHog({ _onCapture: onCapture })
        })

        describe('rate limiting', () => {
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

                posthog.persistence?.clear()

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

    // describe('_calculate_event_properties()', () => {
    //     it('respects property_denylist and property_blacklist', () => {
    //         posthog = createPostHog({
    //             property_denylist: ['$lib', 'persistent', '$is_identified'],
    //             property_blacklist: ['token'],
    //             _onCapture: onCapture,
    //         })

    //         // act
    //         const actual = posthog._calculate_event_properties(eventName, properties)

    //         // assert
    //         expect(actual['event']).toBe('prop')
    //         expect(actual['$lib']).toBeUndefined()
    //         expect(actual['persistent']).toBeUndefined()
    //         expect(actual['$is_identified']).toBeUndefined()
    //         expect(actual['token']).toBeUndefined()
    //     })

    //     given('subject', () =>
    //         given.lib._calculate_event_properties(
    //             given.event_name,
    //             given.properties,
    //             given.start_timestamp,
    //             given.options
    //         )
    //     )

    //     given('event_name', () => 'custom_event')
    //     given('properties', () => ({ event: 'prop' }))

    //     given('options', () => ({}))

    //     given('overrides', () => ({
    //         config: given.config,
    //         persistence: {
    //             properties: () => ({ distinct_id: 'abc', persistent: 'prop', $is_identified: false }),
    //             remove_event_timer: jest.fn(),
    //             get_property: () => 'anonymous',
    //         },
    //         sessionPersistence: {
    //             properties: () => ({ distinct_id: 'abc', persistent: 'prop' }),
    //             get_property: () => 'anonymous',
    //         },
    //         sessionManager: {
    //             checkAndGetSessionAndWindowId: jest.fn().mockReturnValue({
    //                 windowId: 'windowId',
    //                 sessionId: 'sessionId',
    //             }),
    //         },
    //     }))

    //     given('config', () => ({
    //         api_host: 'https://app.posthog.com',
    //         token: 'testtoken',
    //         property_denylist: given.property_denylist,
    //         property_blacklist: given.property_blacklist,
    //         sanitize_properties: given.sanitize_properties,
    //     }))
    //     given('property_denylist', () => [])
    //     given('property_blacklist', () => [])

    //     beforeEach(() => {
    //         jest.spyOn(Info, 'properties').mockReturnValue({ $lib: 'web' })
    //     })

    //     it('returns calculated properties', () => {
    //         expect(given.subject).toEqual({
    //             token: 'testtoken',
    //             event: 'prop',
    //             $lib: 'web',
    //             distinct_id: 'abc',
    //             persistent: 'prop',
    //             $window_id: 'windowId',
    //             $session_id: 'sessionId',
    //             $is_identified: false,
    //             $process_person_profile: true,
    //         })
    //     })

    //     it('sets $lib_custom_api_host if api_host is not the default', () => {
    //         given('config', () => ({
    //             api_host: 'https://custom.posthog.com',
    //             token: 'testtoken',
    //             property_denylist: given.property_denylist,
    //             property_blacklist: given.property_blacklist,
    //             sanitize_properties: given.sanitize_properties,
    //         }))
    //         expect(given.subject).toEqual({
    //             token: 'testtoken',
    //             event: 'prop',
    //             $lib: 'web',
    //             distinct_id: 'abc',
    //             persistent: 'prop',
    //             $window_id: 'windowId',
    //             $session_id: 'sessionId',
    //             $lib_custom_api_host: 'https://custom.posthog.com',
    //             $is_identified: false,
    //             $process_person_profile: true,
    //         })
    //     })

    //     it("can't deny or blacklist $process_person_profile", () => {
    //         given('property_denylist', () => ['$process_person_profile'])
    //         given('property_blacklist', () => ['$process_person_profile'])

    //         expect(given.subject['$process_person_profile']).toEqual(true)
    //     })

    //     it('only adds token and distinct_id if event_name is $snapshot', () => {
    //         given('event_name', () => '$snapshot')
    //         expect(given.subject).toEqual({
    //             token: 'testtoken',
    //             event: 'prop',
    //             distinct_id: 'abc',
    //         })
    //         expect(given.overrides.sessionManager.checkAndGetSessionAndWindowId).not.toHaveBeenCalled()
    //     })

    //     it('calls sanitize_properties', () => {
    //         given('sanitize_properties', () => (props, event_name) => ({ token: props.token, event_name }))

    //         expect(given.subject).toEqual({
    //             event_name: given.event_name,
    //             token: 'testtoken',
    //             $process_person_profile: true,
    //         })
    //     })

    //     it('saves $snapshot data and token for $snapshot events', () => {
    //         given('event_name', () => '$snapshot')
    //         given('properties', () => ({ $snapshot_data: {} }))

    //         expect(given.subject).toEqual({
    //             token: 'testtoken',
    //             $snapshot_data: {},
    //             distinct_id: 'abc',
    //         })
    //     })

    //     it("doesn't modify properties passed into it", () => {
    //         const properties = { prop1: 'val1', prop2: 'val2' }
    //         given.lib._calculate_event_properties(given.event_name, properties, given.start_timestamp, given.options)

    //         expect(Object.keys(properties)).toEqual(['prop1', 'prop2'])
    //     })

    //     it('adds page title to $pageview', () => {
    //         document.title = 'test'

    //         given('event_name', () => '$pageview')

    //         expect(given.subject).toEqual(expect.objectContaining({ title: 'test' }))
    //     })
    // })
})
