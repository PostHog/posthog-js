import { Decide } from '../decide'

import { Info } from '../utils/event-utils'
import { document, window } from '../utils/globals'
import { uuidv7 } from '../uuidv7'
import * as globals from '../utils/globals'
import { USER_STATE } from '../constants'
import { createPosthogInstance, defaultPostHog } from './helpers/posthog-instance'
import { logger } from '../utils/logger'
import { DecideResponse, PostHogConfig } from '../types'
import { PostHog } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'
import { SessionIdManager } from '../sessionid'
import { RequestQueue } from '../request-queue'
import { SessionRecording } from '../extensions/replay/sessionrecording'
import { PostHogFeatureFlags } from '../posthog-featureflags'

jest.mock('../decide')

describe('posthog core', () => {
    const baseUTCDateTime = new Date(Date.UTC(2020, 0, 1, 0, 0, 0))
    const eventName = '$event'

    const defaultConfig = {}

    const defaultOverrides = {
        _send_request: jest.fn(),
    }

    const posthogWith = (config: Partial<PostHogConfig>, overrides?: Partial<PostHog>): PostHog => {
        const posthog = defaultPostHog().init('testtoken', config, uuidv7())
        return Object.assign(posthog, overrides || {})
    }

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(baseUTCDateTime)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    describe('capture()', () => {
        it('adds a UUID to each message', () => {
            const captureData = posthogWith(defaultConfig, defaultOverrides).capture(eventName, {}, {})
            expect(captureData).toHaveProperty('uuid')
        })

        it('adds system time to events', () => {
            const captureData = posthogWith(defaultConfig, defaultOverrides).capture(eventName, {}, {})

            expect(captureData).toHaveProperty('timestamp')
            // timer is fixed at 2020-01-01
            expect(captureData.timestamp).toEqual(baseUTCDateTime)
        })

        it('captures when time is overriden by caller', () => {
            const captureData = posthogWith(defaultConfig, defaultOverrides).capture(
                eventName,
                {},
                { timestamp: new Date(2020, 0, 2, 12, 34) }
            )
            expect(captureData).toHaveProperty('timestamp')
            expect(captureData.timestamp).toEqual(new Date(2020, 0, 2, 12, 34))
            expect(captureData.properties['$event_time_override_provided']).toEqual(true)
            expect(captureData.properties['$event_time_override_system_time']).toEqual(baseUTCDateTime)
        })

        it('handles recursive objects', () => {
            const props: Record<string, any> = {}
            props.recurse = props

            expect(() =>
                posthogWith(defaultConfig, defaultOverrides).capture(eventName, props, {
                    timestamp: new Date(2020, 0, 2, 12, 34),
                })
            ).not.toThrow()
        })

        it('calls callbacks added via _addCaptureHook', () => {
            const hook = jest.fn()
            const posthog = posthogWith(defaultConfig, defaultOverrides)
            posthog._addCaptureHook(hook)

            posthog.capture(eventName, {}, {})
            expect(hook).toHaveBeenCalledWith(
                '$event',
                expect.objectContaining({
                    event: '$event',
                })
            )
        })

        it('calls update_campaign_params and update_referrer_info on sessionPersistence', () => {
            const posthog = posthogWith(
                {
                    property_denylist: [],
                    property_blacklist: [],
                    _onCapture: jest.fn(),
                    store_google: true,
                    save_referrer: true,
                },
                {
                    ...defaultOverrides,
                    sessionPersistence: {
                        update_search_keyword: jest.fn(),
                        update_campaign_params: jest.fn(),
                        update_referrer_info: jest.fn(),
                        update_config: jest.fn(),
                        properties: jest.fn(),
                        get_property: () => 'anonymous',
                    } as unknown as PostHogPersistence,
                }
            )

            posthog.capture(eventName, {}, {})

            expect(posthog.sessionPersistence.update_campaign_params).toHaveBeenCalled()
            expect(posthog.sessionPersistence.update_referrer_info).toHaveBeenCalled()
        })

        it('errors with undefined event name', () => {
            const hook = jest.fn()

            const posthog = posthogWith(defaultConfig, defaultOverrides)
            posthog._addCaptureHook(hook)
            jest.spyOn(logger, 'error').mockImplementation()

            expect(() => posthog.capture(undefined)).not.toThrow()
            expect(hook).not.toHaveBeenCalled()
            expect(logger.error).toHaveBeenCalledWith('No event name provided to posthog.capture')
        })

        it('errors with object event name', () => {
            const hook = jest.fn()
            jest.spyOn(logger, 'error').mockImplementation()

            const posthog = posthogWith(defaultConfig, defaultOverrides)
            posthog._addCaptureHook(hook)

            // @ts-expect-error - testing invalid input
            expect(() => posthog.capture({ event: 'object as name' })).not.toThrow()
            expect(hook).not.toHaveBeenCalled()
            expect(logger.error).toHaveBeenCalledWith('No event name provided to posthog.capture')
        })

        it('respects opt_out_useragent_filter (default: false)', () => {
            const originalUseragent = globals.userAgent
            ;(globals as any)['userAgent'] =
                'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36'

            const hook = jest.fn()
            const posthog = posthogWith(defaultConfig, defaultOverrides)
            posthog._addCaptureHook(hook)

            posthog.capture(eventName, {}, {})
            expect(hook).not.toHaveBeenCalledWith('$event')
            ;(globals as any)['userAgent'] = originalUseragent
        })

        it('respects opt_out_useragent_filter', () => {
            const originalUseragent = globals.userAgent

            ;(globals as any)['userAgent'] =
                'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36'

            const hook = jest.fn()
            const posthog = posthogWith(
                {
                    opt_out_useragent_filter: true,
                    property_denylist: [],
                    property_blacklist: [],
                    _onCapture: jest.fn(),
                },
                defaultOverrides
            )
            posthog._addCaptureHook(hook)

            const event = posthog.capture(eventName, {}, {})

            expect(hook).toHaveBeenCalledWith(
                '$event',
                expect.objectContaining({
                    event: '$event',
                })
            )
            expect(event.properties['$browser_type']).toEqual('bot')
            ;(globals as any)['userAgent'] = originalUseragent
        })

        it('truncates long properties', () => {
            const posthog = posthogWith(
                {
                    properties_string_max_length: 1000,
                    property_denylist: [],
                    property_blacklist: [],
                    _onCapture: jest.fn(),
                },
                defaultOverrides
            )

            const event = posthog.capture(
                eventName,
                {
                    key: 'value'.repeat(10000),
                },
                {}
            )

            expect(event.properties.key.length).toBe(1000)
        })

        it('keeps long properties if undefined', () => {
            const posthog = posthogWith(
                {
                    properties_string_max_length: undefined,
                    property_denylist: [],
                    property_blacklist: [],
                    _onCapture: jest.fn(),
                },
                defaultOverrides
            )

            const event = posthog.capture(
                eventName,
                {
                    key: 'value'.repeat(10000),
                },
                {}
            )

            expect(event.properties.key.length).toBe(50000)
        })

        it('passes through $set and $set_once into the request, if the event is an $identify event', () => {
            // NOTE: this is slightly unusual to test capture for this specific case
            // of being called with $identify as the event name. It might be that we
            // decide that this shouldn't be a special case of capture in this case,
            // but I'll add the case to capture current functionality.
            //
            // We check that if identify is called with user $set and $set_once
            // properties, we also want to ensure capture does the expected thing
            // with them.

            const posthog = posthogWith(defaultConfig, defaultOverrides)

            const captureResult = posthog.capture(
                '$identify',
                { distinct_id: 'some-distinct-id' },
                { $set: { email: 'john@example.com' }, $set_once: { howOftenAmISet: 'once!' } }
            )

            // We assume that the returned result is the object we would send to the
            // server.
            expect(captureResult).toEqual(
                expect.objectContaining({
                    $set: { email: 'john@example.com' },
                    $set_once: expect.objectContaining({ howOftenAmISet: 'once!' }),
                })
            )
        })

        it('updates persisted person properties for feature flags if $set is present', () => {
            const posthog = posthogWith(
                {
                    property_denylist: [],
                    property_blacklist: [],
                    _onCapture: jest.fn(),
                },
                defaultOverrides
            )

            posthog.capture(eventName, {
                $set: { foo: 'bar' },
            })
            expect(posthog.persistence.props.$stored_person_properties).toMatchObject({ foo: 'bar' })
        })

        it('correctly handles the "length" property', () => {
            const posthog = posthogWith(defaultConfig, defaultOverrides)
            const captureResult = posthog.capture('event-name', { foo: 'bar', length: 0 })
            expect(captureResult.properties).toEqual(expect.objectContaining({ foo: 'bar', length: 0 }))
        })

        it('sends payloads to /e/ by default', () => {
            const posthog = posthogWith({ ...defaultConfig, request_batching: false }, defaultOverrides)

            posthog.capture('event-name', { foo: 'bar', length: 0 })

            expect(posthog._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://us.i.posthog.com/e/',
                })
            )
        })

        it('sends payloads to alternative endpoint if given', () => {
            const posthog = posthogWith({ ...defaultConfig, request_batching: false }, defaultOverrides)
            posthog._afterDecideResponse({ analytics: { endpoint: '/i/v0/e/' } } as DecideResponse)

            posthog.capture('event-name', { foo: 'bar', length: 0 })

            expect(posthog._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://us.i.posthog.com/i/v0/e/',
                })
            )
        })

        it('sends payloads to overriden endpoint if given', () => {
            const posthog = posthogWith({ ...defaultConfig, request_batching: false }, defaultOverrides)

            posthog.capture('event-name', { foo: 'bar', length: 0 }, { _url: 'https://app.posthog.com/s/' })

            expect(posthog._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://app.posthog.com/s/',
                })
            )
        })

        it('sends payloads to overriden _url, even if alternative endpoint is set', () => {
            const posthog = posthogWith({ ...defaultConfig, request_batching: false }, defaultOverrides)
            posthog._afterDecideResponse({ analytics: { endpoint: '/i/v0/e/' } } as DecideResponse)

            posthog.capture('event-name', { foo: 'bar', length: 0 }, { _url: 'https://app.posthog.com/s/' })

            expect(posthog._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://app.posthog.com/s/',
                })
            )
        })
    })

    describe('_afterDecideResponse', () => {
        it('enables compression from decide response', () => {
            const posthog = posthogWith({})

            posthog._afterDecideResponse({ supportedCompression: ['gzip-js', 'base64'] } as DecideResponse)

            expect(posthog.compression).toEqual('gzip-js')
        })

        it('enables compression from decide response when only one received', () => {
            const posthog = posthogWith({})

            posthog._afterDecideResponse({ supportedCompression: ['base64'] } as DecideResponse)

            expect(posthog.compression).toEqual('base64')
        })

        it('does not enable compression from decide response if compression is disabled', () => {
            const posthog = posthogWith({ disable_compression: true, persistence: 'memory' })

            posthog._afterDecideResponse({ supportedCompression: ['gzip-js', 'base64'] } as DecideResponse)

            expect(posthog.compression).toEqual(undefined)
        })

        it('defaults to /e if no endpoint is given', () => {
            const posthog = posthogWith({})

            posthog._afterDecideResponse({} as DecideResponse)

            expect(posthog.analyticsDefaultEndpoint).toEqual('/e/')
        })

        it('uses the specified analytics endpoint if given', () => {
            const posthog = posthogWith({})

            posthog._afterDecideResponse({ analytics: { endpoint: '/i/v0/e/' } } as DecideResponse)

            expect(posthog.analyticsDefaultEndpoint).toEqual('/i/v0/e/')
        })
    })

    describe('_calculate_event_properties()', () => {
        let posthog: PostHog

        const overrides: Partial<PostHog> = {
            persistence: {
                properties: () => ({ distinct_id: 'abc', persistent: 'prop', $is_identified: false }),
                remove_event_timer: jest.fn(),
                get_property: () => 'anonymous',
            } as unknown as PostHogPersistence,
            sessionPersistence: {
                properties: () => ({ distinct_id: 'abc', persistent: 'prop' }),
                get_property: () => 'anonymous',
            } as unknown as PostHogPersistence,
            sessionManager: {
                checkAndGetSessionAndWindowId: jest.fn().mockReturnValue({
                    windowId: 'windowId',
                    sessionId: 'sessionId',
                }),
            } as unknown as SessionIdManager,
        }

        beforeEach(() => {
            jest.spyOn(Info, 'properties').mockReturnValue({ $lib: 'web' })

            posthog = posthogWith(
                {
                    api_host: 'https://app.posthog.com',
                    token: 'testtoken',
                    property_denylist: [],
                    property_blacklist: [],
                    sanitize_properties: undefined,
                },
                overrides
            )
        })

        it('returns calculated properties', () => {
            expect(posthog._calculate_event_properties('custom_event', { event: 'prop' }, new Date())).toEqual({
                token: 'testtoken',
                event: 'prop',
                $lib: 'web',
                distinct_id: 'abc',
                persistent: 'prop',
                $window_id: 'windowId',
                $session_id: 'sessionId',
                $is_identified: false,
                $process_person_profile: true,
            })
        })

        it('sets $lib_custom_api_host if api_host is not the default', () => {
            posthog = posthogWith(
                {
                    api_host: 'https://custom.posthog.com',
                },
                overrides
            )

            expect(posthog._calculate_event_properties('custom_event', { event: 'prop' }, new Date())).toEqual({
                token: 'testtoken',
                event: 'prop',
                $lib: 'web',
                distinct_id: 'abc',
                persistent: 'prop',
                $window_id: 'windowId',
                $session_id: 'sessionId',
                $lib_custom_api_host: 'https://custom.posthog.com',
                $is_identified: false,
                $process_person_profile: true,
            })
        })

        it("can't deny or blacklist $process_person_profile", () => {
            posthog = posthogWith(
                {
                    api_host: 'https://custom.posthog.com',
                    property_denylist: ['$process_person_profile'],
                    property_blacklist: ['$process_person_profile'],
                },
                overrides
            )

            expect(
                posthog._calculate_event_properties('custom_event', { event: 'prop' }, new Date())[
                    '$process_person_profile'
                ]
            ).toEqual(true)
        })

        it('only adds token and distinct_id if event_name is $snapshot', () => {
            posthog = posthogWith(
                {
                    api_host: 'https://custom.posthog.com',
                },
                overrides
            )

            expect(posthog._calculate_event_properties('$snapshot', { event: 'prop' }, new Date())).toEqual({
                token: 'testtoken',
                event: 'prop',
                distinct_id: 'abc',
            })
            expect(posthog.sessionManager.checkAndGetSessionAndWindowId).not.toHaveBeenCalled()
        })

        it('calls sanitize_properties', () => {
            posthog = posthogWith(
                {
                    api_host: 'https://custom.posthog.com',
                    sanitize_properties: (props, event_name) => ({ token: props.token, event_name }),
                },
                overrides
            )

            expect(posthog._calculate_event_properties('custom_event', { event: 'prop' }, new Date())).toEqual({
                event_name: 'custom_event',
                token: 'testtoken',
                $process_person_profile: true,
            })
        })

        it('saves $snapshot data and token for $snapshot events', () => {
            posthog = posthogWith({}, overrides)

            expect(posthog._calculate_event_properties('$snapshot', { $snapshot_data: {} }, new Date())).toEqual({
                token: 'testtoken',
                $snapshot_data: {},
                distinct_id: 'abc',
            })
        })

        it("doesn't modify properties passed into it", () => {
            const properties = { prop1: 'val1', prop2: 'val2' }

            posthog._calculate_event_properties('custom_event', properties, new Date())

            expect(Object.keys(properties)).toEqual(['prop1', 'prop2'])
        })

        it('adds page title to $pageview', () => {
            document!.title = 'test'

            expect(posthog._calculate_event_properties('$pageview', {}, new Date())).toEqual(
                expect.objectContaining({ title: 'test' })
            )
        })
    })

    describe('_handle_unload()', () => {
        it('captures $pageleave', () => {
            const posthog = posthogWith(
                {
                    capture_pageview: true,
                    capture_pageleave: 'if_capture_pageview',
                    request_batching: true,
                },
                { capture: jest.fn() }
            )

            posthog._handle_unload()

            expect(posthog.capture).toHaveBeenCalledWith('$pageleave')
        })

        it('does not capture $pageleave when capture_pageview=false and capture_pageleave=if_capture_pageview', () => {
            const posthog = posthogWith(
                {
                    capture_pageview: false,
                    capture_pageleave: 'if_capture_pageview',
                    request_batching: true,
                },
                { capture: jest.fn() }
            )

            posthog._handle_unload()

            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('does capture $pageleave when capture_pageview=false and capture_pageleave=true', () => {
            const posthog = posthogWith(
                {
                    capture_pageview: false,
                    capture_pageleave: true,
                    request_batching: true,
                },
                { capture: jest.fn() }
            )

            posthog._handle_unload()

            expect(posthog.capture).toHaveBeenCalledWith('$pageleave')
        })

        it('calls requestQueue unload', () => {
            const posthog = posthogWith(
                {
                    capture_pageview: true,
                    capture_pageleave: 'if_capture_pageview',
                    request_batching: true,
                },
                { _requestQueue: { enqueue: jest.fn(), unload: jest.fn() } as unknown as RequestQueue }
            )

            posthog._handle_unload()

            expect(posthog._requestQueue.unload).toHaveBeenCalledTimes(1)
        })

        describe('without batching', () => {
            it('captures $pageleave', () => {
                const posthog = posthogWith(
                    {
                        capture_pageview: true,
                        capture_pageleave: 'if_capture_pageview',
                        request_batching: false,
                    },
                    { capture: jest.fn() }
                )
                posthog._handle_unload()

                expect(posthog.capture).toHaveBeenCalledWith('$pageleave', null, { transport: 'sendBeacon' })
            })

            it('does not capture $pageleave when capture_pageview=false', () => {
                const posthog = posthogWith(
                    {
                        capture_pageview: false,
                        capture_pageleave: 'if_capture_pageview',
                        request_batching: false,
                    },
                    { capture: jest.fn() }
                )
                posthog._handle_unload()

                expect(posthog.capture).not.toHaveBeenCalled()
            })
        })
    })

    describe('bootstrapping feature flags', () => {
        it('sets the right distinctID', () => {
            const posthog = posthogWith(
                {
                    bootstrap: {
                        distinctID: 'abcd',
                    },
                },
                { capture: jest.fn() }
            )

            expect(posthog.get_distinct_id()).toBe('abcd')
            expect(posthog.get_property('$device_id')).toBe('abcd')
            expect(posthog.persistence.get_property(USER_STATE)).toBe('anonymous')

            posthog.identify('efgh')

            expect(posthog.capture).toHaveBeenCalledWith(
                '$identify',
                {
                    distinct_id: 'efgh',
                    $anon_distinct_id: 'abcd',
                },
                { $set: {}, $set_once: {} }
            )
        })

        it('treats identified distinctIDs appropriately', () => {
            const posthog = posthogWith(
                {
                    bootstrap: {
                        distinctID: 'abcd',
                        isIdentifiedID: true,
                    },
                    get_device_id: () => 'og-device-id',
                },
                { capture: jest.fn() }
            )

            expect(posthog.get_distinct_id()).toBe('abcd')
            expect(posthog.get_property('$device_id')).toBe('og-device-id')
            expect(posthog.persistence.get_property(USER_STATE)).toBe('identified')

            posthog.identify('efgh')
            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('sets the right feature flags', () => {
            const posthog = posthogWith({
                bootstrap: {
                    featureFlags: {
                        multivariant: 'variant-1',
                        enabled: true,
                        disabled: false,
                        // TODO why are we testing that undefined is passed through?
                        undef: undefined as unknown as string | boolean,
                    },
                },
            })

            expect(posthog.get_distinct_id()).not.toBe('abcd')
            expect(posthog.get_distinct_id()).not.toEqual(undefined)
            expect(posthog.getFeatureFlag('multivariant')).toBe('variant-1')
            expect(posthog.getFeatureFlag('disabled')).toBe(undefined)
            expect(posthog.getFeatureFlag('undef')).toBe(undefined)
            expect(posthog.featureFlags.getFlagVariants()).toEqual({ multivariant: 'variant-1', enabled: true })
        })

        it('sets the right feature flag payloads', () => {
            const posthog = posthogWith({
                bootstrap: {
                    featureFlags: {
                        multivariant: 'variant-1',
                        enabled: true,
                        jsonString: true,
                        disabled: false,
                        // TODO why are we testing that undefined is passed through?
                        undef: undefined as unknown as string | boolean,
                    },
                    featureFlagPayloads: {
                        multivariant: 'some-payload',
                        enabled: {
                            another: 'value',
                        },
                        disabled: 'should not show',
                        undef: 200,
                        jsonString: '{"a":"payload"}',
                    },
                },
            })

            expect(posthog.getFeatureFlagPayload('multivariant')).toBe('some-payload')
            expect(posthog.getFeatureFlagPayload('enabled')).toEqual({ another: 'value' })
            expect(posthog.getFeatureFlagPayload('jsonString')).toEqual({ a: 'payload' })
            expect(posthog.getFeatureFlagPayload('disabled')).toBe(undefined)
            expect(posthog.getFeatureFlagPayload('undef')).toBe(undefined)
        })

        it('does nothing when empty', () => {
            jest.spyOn(logger, 'warn').mockImplementation()

            const posthog = posthogWith({
                bootstrap: {},
                persistence: 'memory',
            })

            expect(posthog.get_distinct_id()).not.toBe('abcd')
            expect(posthog.get_distinct_id()).not.toEqual(undefined)
            expect(posthog.getFeatureFlag('multivariant')).toBe(undefined)
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('getFeatureFlag for key "multivariant" failed')
            )
            expect(posthog.getFeatureFlag('disabled')).toBe(undefined)
            expect(posthog.getFeatureFlag('undef')).toBe(undefined)
            expect(posthog.featureFlags.getFlagVariants()).toEqual({})
        })

        it('onFeatureFlags should be called immediately if feature flags are bootstrapped', () => {
            let called = false
            const posthog = posthogWith({
                bootstrap: {
                    featureFlags: { multivariant: 'variant-1' },
                },
            })

            posthog.featureFlags.onFeatureFlags(() => (called = true))
            expect(called).toEqual(true)
        })

        it('onFeatureFlags should not be called immediately if feature flags bootstrap is empty', () => {
            let called = false

            const posthog = posthogWith({
                bootstrap: {
                    featureFlags: {},
                },
            })

            posthog.featureFlags.onFeatureFlags(() => (called = true))
            expect(called).toEqual(false)
        })

        it('onFeatureFlags should not be called immediately if feature flags bootstrap is undefined', () => {
            let called = false

            const posthog = posthogWith({
                bootstrap: {
                    featureFlags: undefined,
                },
            })

            posthog.featureFlags.onFeatureFlags(() => (called = true))
            expect(called).toEqual(false)
        })
    })

    describe('init()', () => {
        jest.spyOn(window, 'window', 'get')

        beforeEach(() => {
            jest.spyOn(window.console, 'warn').mockImplementation()
            jest.spyOn(window.console, 'error').mockImplementation()
        })

        it('can set an xhr error handler', () => {
            const fakeOnXHRError = jest.fn()
            const posthog = posthogWith({
                on_xhr_error: fakeOnXHRError,
            })
            expect(posthog.config.on_xhr_error).toBe(fakeOnXHRError)
        })

        it.skip('does not load feature flags, session recording', () => {
            // TODO this didn't make a tonne of sense in the given form
            // it makes no sense now
            // of course mocks added _after_ init will not be called
            const posthog = defaultPostHog().init('testtoken', defaultConfig, uuidv7())!

            posthog.sessionRecording = {
                afterDecideResponse: jest.fn(),
                startIfEnabledOrStop: jest.fn(),
            } as unknown as SessionRecording
            posthog.persistence = {
                register: jest.fn(),
                update_config: jest.fn(),
            } as unknown as PostHogPersistence

            // Feature flags
            expect(posthog.persistence.register).not.toHaveBeenCalled() // FFs are saved this way

            // Session recording
            expect(posthog.sessionRecording.afterDecideResponse).not.toHaveBeenCalled()
        })

        describe('device id behavior', () => {
            let uninitialisedPostHog: PostHog
            beforeEach(() => {
                uninitialisedPostHog = defaultPostHog()
            })

            it('sets a random UUID as distinct_id/$device_id if distinct_id is unset', () => {
                uninitialisedPostHog.persistence = {
                    props: { distinct_id: undefined },
                } as unknown as PostHogPersistence
                const posthog = uninitialisedPostHog.init(
                    uuidv7(),
                    {
                        get_device_id: (uuid) => uuid,
                    },
                    uuidv7()
                )!

                expect(posthog.persistence!.props).toMatchObject({
                    $device_id: expect.stringMatching(/^[0-9a-f-]+$/),
                    distinct_id: expect.stringMatching(/^[0-9a-f-]+$/),
                })

                expect(posthog.persistence!.props.$device_id).toEqual(posthog.persistence!.props.distinct_id)
            })

            it('does not set distinct_id/$device_id if distinct_id is unset', () => {
                uninitialisedPostHog.persistence = {
                    props: { distinct_id: 'existing-id' },
                } as unknown as PostHogPersistence
                const posthog = uninitialisedPostHog.init(
                    uuidv7(),
                    {
                        get_device_id: (uuid) => uuid,
                    },
                    uuidv7()
                )!

                expect(posthog.persistence!.props.distinct_id).not.toEqual('existing-id')
            })

            it('uses config.get_device_id for uuid generation if passed', () => {
                const posthog = uninitialisedPostHog.init(
                    uuidv7(),
                    {
                        get_device_id: (uuid) => 'custom-' + uuid.slice(0, 8),
                        persistence: 'memory',
                    },
                    uuidv7()
                )!

                expect(posthog.persistence!.props).toMatchObject({
                    $device_id: expect.stringMatching(/^custom-[0-9a-f-]+$/),
                    distinct_id: expect.stringMatching(/^custom-[0-9a-f-]+$/),
                })
            })
        })
    })

    describe('skipped init()', () => {
        it('capture() does not throw', () => {
            jest.spyOn(logger, 'error').mockImplementation()

            expect(() => defaultPostHog().capture('$pageview')).not.toThrow()

            expect(logger.error).toHaveBeenCalledWith('You must initialize PostHog before calling posthog.capture')
        })
    })

    describe('group()', () => {
        let posthog: PostHog

        beforeEach(() => {
            posthog = defaultPostHog().init(
                'testtoken',
                {
                    persistence: 'memory',
                },
                uuidv7()
            )!
            posthog.persistence!.clear()
            posthog.reloadFeatureFlags = jest.fn()
            posthog.capture = jest.fn()
        })

        it('records info on groups', () => {
            posthog.group('organization', 'org::5')
            expect(posthog.getGroups()).toEqual({ organization: 'org::5' })

            posthog.group('organization', 'org::6')
            expect(posthog.getGroups()).toEqual({ organization: 'org::6' })

            posthog.group('instance', 'app.posthog.com')
            expect(posthog.getGroups()).toEqual({ organization: 'org::6', instance: 'app.posthog.com' })
        })

        it('records info on groupProperties for groups', () => {
            posthog.group('organization', 'org::5', { name: 'PostHog' })
            expect(posthog.getGroups()).toEqual({ organization: 'org::5' })

            expect(posthog.persistence!.props['$stored_group_properties']).toEqual({
                organization: { name: 'PostHog' },
            })

            posthog.group('organization', 'org::6')
            expect(posthog.getGroups()).toEqual({ organization: 'org::6' })
            expect(posthog.persistence!.props['$stored_group_properties']).toEqual({ organization: {} })

            posthog.group('instance', 'app.posthog.com')
            expect(posthog.getGroups()).toEqual({ organization: 'org::6', instance: 'app.posthog.com' })
            expect(posthog.persistence!.props['$stored_group_properties']).toEqual({ organization: {}, instance: {} })

            // now add properties to the group
            posthog.group('organization', 'org::7', { name: 'PostHog2' })
            expect(posthog.getGroups()).toEqual({ organization: 'org::7', instance: 'app.posthog.com' })
            expect(posthog.persistence!.props['$stored_group_properties']).toEqual({
                organization: { name: 'PostHog2' },
                instance: {},
            })

            posthog.group('instance', 'app.posthog.com', { a: 'b' })
            expect(posthog.getGroups()).toEqual({ organization: 'org::7', instance: 'app.posthog.com' })
            expect(posthog.persistence!.props['$stored_group_properties']).toEqual({
                organization: { name: 'PostHog2' },
                instance: { a: 'b' },
            })

            posthog.resetGroupPropertiesForFlags()
            expect(posthog.persistence!.props['$stored_group_properties']).toEqual(undefined)
        })

        it('does not result in a capture call', () => {
            posthog.group('organization', 'org::5')

            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('results in a reloadFeatureFlags call if group changes', () => {
            posthog.group('organization', 'org::5', { name: 'PostHog' })
            posthog.group('instance', 'app.posthog.com')
            posthog.group('organization', 'org::5')

            expect(posthog.reloadFeatureFlags).toHaveBeenCalledTimes(2)
        })

        it('results in a reloadFeatureFlags call if group properties change', () => {
            posthog.group('organization', 'org::5')
            posthog.group('instance', 'app.posthog.com')
            posthog.group('organization', 'org::5', { name: 'PostHog' })
            posthog.group('instance', 'app.posthog.com')

            expect(posthog.reloadFeatureFlags).toHaveBeenCalledTimes(3)
        })

        it('captures $groupidentify event', () => {
            posthog.group('organization', 'org::5', { group: 'property', foo: 5 })

            expect(posthog.capture).toHaveBeenCalledWith('$groupidentify', {
                $group_type: 'organization',
                $group_key: 'org::5',
                $group_set: {
                    group: 'property',
                    foo: 5,
                },
            })
        })

        describe('subsequent capture calls', () => {
            beforeEach(() => {
                posthog = defaultPostHog().init(
                    'testtoken',
                    {
                        persistence: 'memory',
                    },
                    uuidv7()
                )!
                posthog.persistence!.clear()
                // mock this internal queue - not capture
                posthog._requestQueue = {
                    enqueue: jest.fn(),
                } as unknown as RequestQueue
            })

            it('sends group information in event properties', () => {
                posthog.group('organization', 'org::5')
                posthog.group('instance', 'app.posthog.com')

                posthog.capture('some_event', { prop: 5 })

                expect(posthog._requestQueue!.enqueue).toHaveBeenCalledTimes(1)

                const eventPayload = jest.mocked(posthog._requestQueue!.enqueue).mock.calls[0][0]
                // need to help TS know event payload data is not an array
                // eslint-disable-next-line posthog-js/no-direct-array-check
                if (Array.isArray(eventPayload.data!)) {
                    throw new Error('')
                }
                expect(eventPayload.data!.event).toEqual('some_event')
                expect(eventPayload.data!.properties.$groups).toEqual({
                    organization: 'org::5',
                    instance: 'app.posthog.com',
                })
            })
        })

        describe('error handling', () => {
            it('handles blank keys being passed', () => {
                ;(window as any).console.error = jest.fn()
                ;(window as any).console.warn = jest.fn()

                posthog.register = jest.fn()

                posthog.group(null as unknown as string, 'foo')
                posthog.group('organization', null as unknown as string)
                posthog.group('organization', undefined as unknown as string)
                posthog.group('organization', '')
                posthog.group('', 'foo')

                expect(posthog.register).not.toHaveBeenCalled()
            })
        })

        describe('reset group', () => {
            it('groups property is empty and reloads feature flags', () => {
                posthog.group('organization', 'org::5')
                posthog.group('instance', 'app.posthog.com', { group: 'property', foo: 5 })

                expect(posthog.persistence!.props['$groups']).toEqual({
                    organization: 'org::5',
                    instance: 'app.posthog.com',
                })

                expect(posthog.persistence!.props['$stored_group_properties']).toEqual({
                    organization: {},
                    instance: {
                        group: 'property',
                        foo: 5,
                    },
                })

                posthog.resetGroups()

                expect(posthog.persistence!.props['$groups']).toEqual({})
                expect(posthog.persistence!.props['$stored_group_properties']).toEqual(undefined)

                expect(posthog.reloadFeatureFlags).toHaveBeenCalledTimes(3)
            })
        })
    })

    describe('_loaded()', () => {
        it('calls loaded config option', () => {
            const posthog = posthogWith(
                { loaded: jest.fn() },
                {
                    capture: jest.fn(),
                    featureFlags: {
                        setReloadingPaused: jest.fn(),
                        resetRequestQueue: jest.fn(),
                        _startReloadTimer: jest.fn(),
                    } as unknown as PostHogFeatureFlags,
                    _start_queue_if_opted_in: jest.fn(),
                }
            )

            posthog._loaded()

            expect(posthog.config.loaded).toHaveBeenCalledWith(posthog)
        })

        it('handles loaded config option throwing gracefully', () => {
            jest.spyOn(logger, 'critical').mockImplementation()

            const posthog = posthogWith(
                {
                    loaded: () => {
                        throw Error()
                    },
                },
                {
                    capture: jest.fn(),
                    featureFlags: {
                        setReloadingPaused: jest.fn(),
                        resetRequestQueue: jest.fn(),
                        _startReloadTimer: jest.fn(),
                    } as unknown as PostHogFeatureFlags,
                    _start_queue_if_opted_in: jest.fn(),
                }
            )

            posthog._loaded()

            expect(logger.critical).toHaveBeenCalledWith('`loaded` function failed', expect.anything())
        })

        describe('/decide', () => {
            beforeEach(() => {
                const call = jest.fn()
                ;(Decide as any).mockImplementation(() => ({ call }))
            })

            afterEach(() => {
                ;(Decide as any).mockReset()
            })

            it('is called by default', async () => {
                const instance = await createPosthogInstance(uuidv7())
                instance.featureFlags.setReloadingPaused = jest.fn()
                instance._loaded()

                expect(new Decide(instance).call).toHaveBeenCalled()
                expect(instance.featureFlags.setReloadingPaused).toHaveBeenCalledWith(true)
            })

            it('does not call decide if disabled', async () => {
                const instance = await createPosthogInstance(uuidv7(), {
                    advanced_disable_decide: true,
                })
                instance.featureFlags.setReloadingPaused = jest.fn()
                instance._loaded()

                expect(new Decide(instance).call).not.toHaveBeenCalled()
                expect(instance.featureFlags.setReloadingPaused).not.toHaveBeenCalled()
            })
        })
    })

    describe('capturing pageviews', () => {
        it('captures not capture pageview if disabled', async () => {
            jest.useFakeTimers()

            const instance = await createPosthogInstance(uuidv7(), {
                capture_pageview: false,
            })
            instance.capture = jest.fn()

            // TODO you shouldn't need to emit an event to get the pending timer to emit the pageview
            // but you do :shrug:
            instance.capture('not a pageview', {})

            jest.runOnlyPendingTimers()

            expect(instance.capture).not.toHaveBeenLastCalledWith(
                '$pageview',
                { title: 'test' },
                { send_instantly: true }
            )
        })

        it('captures pageview if enabled', async () => {
            jest.useFakeTimers()

            const instance = await createPosthogInstance(uuidv7(), {
                capture_pageview: true,
            })
            instance.capture = jest.fn()

            // TODO you shouldn't need to emit an event to get the pending timer to emit the pageview
            // but you do :shrug:
            instance.capture('not a pageview', {})

            jest.runOnlyPendingTimers()

            expect(instance.capture).toHaveBeenLastCalledWith('$pageview', { title: 'test' }, { send_instantly: true })
        })
    })

    describe('session_id', () => {
        let instance: PostHog
        let token: string

        beforeEach(async () => {
            token = uuidv7()
            instance = await createPosthogInstance(token, {
                api_host: 'https://us.posthog.com',
            })
            instance.sessionManager!.checkAndGetSessionAndWindowId = jest.fn().mockReturnValue({
                windowId: 'windowId',
                sessionId: 'sessionId',
                sessionStartTimestamp: new Date().getTime() - 30000,
            })
        })

        it('returns the session_id', () => {
            expect(instance.get_session_id()).toEqual('sessionId')
        })

        it('returns the replay URL', () => {
            expect(instance.get_session_replay_url()).toEqual(
                `https://us.posthog.com/project/${token}/replay/sessionId`
            )
        })

        it('returns the replay URL including timestamp', () => {
            expect(instance.get_session_replay_url({ withTimestamp: true })).toEqual(
                `https://us.posthog.com/project/${token}/replay/sessionId?t=20` // default lookback is 10 seconds
            )

            expect(instance.get_session_replay_url({ withTimestamp: true, timestampLookBack: 0 })).toEqual(
                `https://us.posthog.com/project/${token}/replay/sessionId?t=30`
            )
        })
    })

    it('deprecated web performance observer still exposes _forceAllowLocalhost', async () => {
        const posthog = await createPosthogInstance(uuidv7())
        expect(posthog.webPerformance._forceAllowLocalhost).toBe(false)
        expect(() => posthog.webPerformance._forceAllowLocalhost).not.toThrow()
    })
})
