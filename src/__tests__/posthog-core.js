import { Decide } from '../decide'

import { Info } from '../utils/event-utils'
import { document, window } from '../utils/globals'
import { uuidv7 } from '../uuidv7'
import * as globals from '../utils/globals'
import { USER_STATE } from '../constants'
import { createPosthogInstance, defaultPostHog } from './helpers/posthog-instance'

jest.mock('../decide')

describe('posthog core', () => {
    const baseUTCDateTime = new Date(Date.UTC(2020, 0, 1, 0, 0, 0))

    given('lib', () => {
        const posthog = defaultPostHog().init('testtoken', given.config, uuidv7())
        posthog.debug()
        return Object.assign(posthog, given.overrides)
    })

    const posthogWith = (config) => {
        const posthog = defaultPostHog().init('testtoken', config, uuidv7())
        posthog._send_request = jest.fn()
        posthog.capture = jest.fn()
        posthog._requestQueue = {
            unload: jest.fn(),
        }
        return posthog
    }

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(baseUTCDateTime)
    })

    afterEach(() => {
        jest.useRealTimers()
        // Make sure there's no cached persistence
        given.lib.persistence?.clear?.()
    })

    describe('capture()', () => {
        given('eventName', () => '$event')

        given('subject', () => () => given.lib.capture(given.eventName, given.eventProperties, given.options))

        given('config', () => ({
            api_host: 'https://app.posthog.com',
            property_denylist: [],
            property_blacklist: [],
            _onCapture: jest.fn(),
            get_device_id: jest.fn().mockReturnValue('device-id'),
        }))

        given('overrides', () => ({
            __loaded: true,
            config: {
                api_host: 'https://app.posthog.com',
                ...given.config,
            },
            persistence: {
                remove_event_timer: jest.fn(),
                properties: jest.fn(),
                update_config: jest.fn(),
                register(properties) {
                    // Simplified version of the real thing
                    Object.assign(this.props, properties)
                },
                props: {},
                get_property: () => 'anonymous',
                set_initial_person_info: jest.fn(),
                get_initial_props: () => ({}),
            },
            sessionPersistence: {
                update_search_keyword: jest.fn(),
                update_campaign_params: jest.fn(),
                update_referrer_info: jest.fn(),
                update_config: jest.fn(),
                properties: jest.fn(),
                get_property: () => 'anonymous',
            },
            _send_request: jest.fn(),
            compression: {},
            __captureHooks: [],
            rateLimiter: {
                isServerRateLimited: () => false,
                clientRateLimitContext: () => false,
            },
        }))

        it('adds a UUID to each message', () => {
            const captureData = given.subject()
            expect(captureData).toHaveProperty('uuid')
        })

        it('adds system time to events', () => {
            const captureData = given.subject()
            console.log(captureData)
            expect(captureData).toHaveProperty('timestamp')
            // timer is fixed at 2020-01-01
            expect(captureData.timestamp).toEqual(baseUTCDateTime)
        })

        it('captures when time is overriden by caller', () => {
            given.options = { timestamp: new Date(2020, 0, 2, 12, 34) }
            const captureData = given.subject()
            expect(captureData).toHaveProperty('timestamp')
            expect(captureData.timestamp).toEqual(new Date(2020, 0, 2, 12, 34))
            expect(captureData.properties['$event_time_override_provided']).toEqual(true)
            expect(captureData.properties['$event_time_override_system_time']).toEqual(baseUTCDateTime)
        })

        it('handles recursive objects', () => {
            given('eventProperties', () => {
                const props = {}
                props.recurse = props
                return props
            })

            expect(() => given.subject()).not.toThrow()
        })

        it('calls callbacks added via _addCaptureHook', () => {
            const hook = jest.fn()

            given.lib._addCaptureHook(hook)

            given.subject()
            expect(hook).toHaveBeenCalledWith(
                '$event',
                expect.objectContaining({
                    event: '$event',
                })
            )
        })

        it('calls update_campaign_params and update_referrer_info on sessionPersistence', () => {
            given('config', () => ({
                property_denylist: [],
                property_blacklist: [],
                _onCapture: jest.fn(),
                store_google: true,
                save_referrer: true,
            }))

            given.subject()

            expect(given.lib.sessionPersistence.update_campaign_params).toHaveBeenCalled()
            expect(given.lib.sessionPersistence.update_referrer_info).toHaveBeenCalled()
        })

        it('errors with undefined event name', () => {
            given('eventName', () => undefined)
            console.error = jest.fn()

            const hook = jest.fn()
            given.lib._addCaptureHook(hook)

            expect(() => given.subject()).not.toThrow()
            expect(hook).not.toHaveBeenCalled()
            expect(console.error).toHaveBeenCalledWith('[PostHog.js]', 'No event name provided to posthog.capture')
        })

        it('errors with object event name', () => {
            given('eventName', () => ({ event: 'object as name' }))
            console.error = jest.fn()

            const hook = jest.fn()
            given.lib._addCaptureHook(hook)

            expect(() => given.subject()).not.toThrow()
            expect(hook).not.toHaveBeenCalled()
            expect(console.error).toHaveBeenCalledWith('[PostHog.js]', 'No event name provided to posthog.capture')
        })

        it('respects opt_out_useragent_filter (default: false)', () => {
            const originalUseragent = globals.userAgent
            // eslint-disable-next-line no-import-assign
            globals['userAgent'] =
                'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36'

            const hook = jest.fn()
            given.lib._addCaptureHook(hook)
            given.subject()
            expect(hook).not.toHaveBeenCalledWith('$event')

            // eslint-disable-next-line no-import-assign
            globals['userAgent'] = originalUseragent
        })

        it('respects opt_out_useragent_filter', () => {
            const originalUseragent = globals.userAgent

            given('config', () => ({
                opt_out_useragent_filter: true,
                property_denylist: [],
                property_blacklist: [],
                _onCapture: jest.fn(),
            }))

            // eslint-disable-next-line no-import-assign
            globals['userAgent'] =
                'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36'

            const hook = jest.fn()
            given.lib._addCaptureHook(hook)
            const event = given.subject()
            expect(hook).toHaveBeenCalledWith(
                '$event',
                expect.objectContaining({
                    event: '$event',
                })
            )
            expect(event.properties['$browser_type']).toEqual('bot')

            // eslint-disable-next-line no-import-assign
            globals['userAgent'] = originalUseragent
        })

        it('truncates long properties', () => {
            given('config', () => ({
                properties_string_max_length: 1000,
                property_denylist: [],
                property_blacklist: [],
                _onCapture: jest.fn(),
            }))
            given('eventProperties', () => ({
                key: 'value'.repeat(10000),
            }))
            const event = given.subject()
            expect(event.properties.key.length).toBe(1000)
        })

        it('keeps long properties if null', () => {
            given('config', () => ({
                properties_string_max_length: null,
                property_denylist: [],
                property_blacklist: [],
                _onCapture: jest.fn(),
            }))
            given('eventProperties', () => ({
                key: 'value'.repeat(10000),
            }))
            const event = given.subject()
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
            const captureResult = given.lib.capture(
                '$identify',
                { distinct_id: 'some-distinct-id' },
                { $set: { email: 'john@example.com' }, $set_once: { howOftenAmISet: 'once!' } }
            )

            // We assume that the returned result is the object we would send to the
            // server.
            expect(captureResult).toEqual(
                expect.objectContaining({ $set: { email: 'john@example.com' }, $set_once: { howOftenAmISet: 'once!' } })
            )
        })

        it('updates persisted person properties for feature flags if $set is present', () => {
            given('config', () => ({
                property_denylist: [],
                property_blacklist: [],
                _onCapture: jest.fn(),
            }))
            given('eventProperties', () => ({
                $set: { foo: 'bar' },
            }))
            given.subject()
            expect(given.overrides.persistence.props.$stored_person_properties).toMatchObject({ foo: 'bar' })
        })

        it('correctly handles the "length" property', () => {
            const captureResult = given.lib.capture('event-name', { foo: 'bar', length: 0 })
            expect(captureResult.properties).toEqual(expect.objectContaining({ foo: 'bar', length: 0 }))
        })

        it('sends payloads to /e/ by default', () => {
            given.lib.capture('event-name', { foo: 'bar', length: 0 })
            expect(given.lib._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://us.i.posthog.com/e/',
                })
            )
        })

        it('sends payloads to alternative endpoint if given', () => {
            given.lib._afterDecideResponse({ analytics: { endpoint: '/i/v0/e/' } })
            given.lib.capture('event-name', { foo: 'bar', length: 0 })

            expect(given.lib._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://us.i.posthog.com/i/v0/e/',
                })
            )
        })

        it('sends payloads to overriden endpoint if given', () => {
            given.lib.capture('event-name', { foo: 'bar', length: 0 }, { _url: 'https://app.posthog.com/s/' })
            expect(given.lib._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://app.posthog.com/s/',
                })
            )
        })

        it('sends payloads to overriden _url, even if alternative endpoint is set', () => {
            given.lib._afterDecideResponse({ analytics: { endpoint: '/i/v0/e/' } })
            given.lib.capture('event-name', { foo: 'bar', length: 0 }, { _url: 'https://app.posthog.com/s/' })
            expect(given.lib._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://app.posthog.com/s/',
                })
            )
        })
    })

    describe('_afterDecideResponse', () => {
        given('subject', () => () => given.lib._afterDecideResponse(given.decideResponse))

        it('enables compression from decide response', () => {
            given('decideResponse', () => ({ supportedCompression: ['gzip-js', 'base64'] }))
            given.subject()

            expect(given.lib.compression).toEqual('gzip-js')
        })

        it('enables compression from decide response when only one received', () => {
            given('decideResponse', () => ({ supportedCompression: ['base64'] }))
            given.subject()

            expect(given.lib.compression).toEqual('base64')
        })

        it('does not enable compression from decide response if compression is disabled', () => {
            given('config', () => ({ disable_compression: true, persistence: 'memory' }))
            given('decideResponse', () => ({ supportedCompression: ['gzip-js', 'base64'] }))
            given.subject()

            expect(given.lib.compression).toEqual(undefined)
        })

        it('defaults to /e if no endpoint is given', () => {
            given('decideResponse', () => ({}))
            given.subject()

            expect(given.lib.analyticsDefaultEndpoint).toEqual('/e/')
        })

        it('uses the specified analytics endpoint if given', () => {
            given('decideResponse', () => ({ analytics: { endpoint: '/i/v0/e/' } }))
            given.subject()

            expect(given.lib.analyticsDefaultEndpoint).toEqual('/i/v0/e/')
        })
    })

    describe('_calculate_event_properties()', () => {
        given('subject', () =>
            given.lib._calculate_event_properties(
                given.event_name,
                given.properties,
                given.start_timestamp,
                given.options
            )
        )

        given('event_name', () => 'custom_event')
        given('properties', () => ({ event: 'prop' }))

        given('options', () => ({}))

        given('overrides', () => ({
            config: given.config,
            persistence: {
                properties: () => ({ distinct_id: 'abc', persistent: 'prop', $is_identified: false }),
                remove_event_timer: jest.fn(),
                get_property: () => 'anonymous',
            },
            sessionPersistence: {
                properties: () => ({ distinct_id: 'abc', persistent: 'prop' }),
                get_property: () => 'anonymous',
            },
            sessionManager: {
                checkAndGetSessionAndWindowId: jest.fn().mockReturnValue({
                    windowId: 'windowId',
                    sessionId: 'sessionId',
                }),
            },
        }))

        given('config', () => ({
            api_host: 'https://app.posthog.com',
            token: 'testtoken',
            property_denylist: given.property_denylist,
            property_blacklist: given.property_blacklist,
            sanitize_properties: given.sanitize_properties,
        }))
        given('property_denylist', () => [])
        given('property_blacklist', () => [])

        beforeEach(() => {
            jest.spyOn(Info, 'properties').mockReturnValue({ $lib: 'web' })
        })

        it('returns calculated properties', () => {
            expect(given.subject).toEqual({
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
            given('config', () => ({
                api_host: 'https://custom.posthog.com',
                token: 'testtoken',
                property_denylist: given.property_denylist,
                property_blacklist: given.property_blacklist,
                sanitize_properties: given.sanitize_properties,
            }))
            expect(given.subject).toEqual({
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
            given('property_denylist', () => ['$process_person_profile'])
            given('property_blacklist', () => ['$process_person_profile'])

            expect(given.subject['$process_person_profile']).toEqual(true)
        })

        it('only adds token and distinct_id if event_name is $snapshot', () => {
            given('event_name', () => '$snapshot')
            expect(given.subject).toEqual({
                token: 'testtoken',
                event: 'prop',
                distinct_id: 'abc',
            })
            expect(given.overrides.sessionManager.checkAndGetSessionAndWindowId).not.toHaveBeenCalled()
        })

        it('calls sanitize_properties', () => {
            given('sanitize_properties', () => (props, event_name) => ({ token: props.token, event_name }))

            expect(given.subject).toEqual({
                event_name: given.event_name,
                token: 'testtoken',
                $process_person_profile: true,
            })
        })

        it('saves $snapshot data and token for $snapshot events', () => {
            given('event_name', () => '$snapshot')
            given('properties', () => ({ $snapshot_data: {} }))

            expect(given.subject).toEqual({
                token: 'testtoken',
                $snapshot_data: {},
                distinct_id: 'abc',
            })
        })

        it("doesn't modify properties passed into it", () => {
            const properties = { prop1: 'val1', prop2: 'val2' }
            given.lib._calculate_event_properties(given.event_name, properties, given.start_timestamp, given.options)

            expect(Object.keys(properties)).toEqual(['prop1', 'prop2'])
        })

        it('adds page title to $pageview', () => {
            document.title = 'test'

            given('event_name', () => '$pageview')

            expect(given.subject).toEqual(expect.objectContaining({ title: 'test' }))
        })
    })

    describe('_handle_unload()', () => {
        given('subject', () => () => given.lib._handle_unload())

        given('overrides', () => ({
            config: given.config,
            capture: jest.fn(),
            compression: {},
            _requestQueue: {
                unload: jest.fn(),
            },
            _retryQueue: {
                unload: jest.fn(),
            },
        }))

        given('config', () => ({
            capture_pageview: given.capturePageview,
            capture_pageleave: given.capturePageleave,
            request_batching: given.batching,
        }))

        given('capturePageview', () => true)
        given('capturePageleave', () => 'if_capture_pageview')
        given('batching', () => true)

        it('captures $pageleave', () => {
            const posthog = posthogWith({
                capture_pageview: true,
                capture_pageleave: 'if_capture_pageview',
                batching: true,
            })

            posthog._handle_unload()

            expect(posthog.capture).toHaveBeenCalledWith('$pageleave')
        })

        it('does not capture $pageleave when capture_pageview=false and capture_pageleave=if_capture_pageview', () => {
            const posthog = posthogWith({
                capture_pageview: false,
                capture_pageleave: 'if_capture_pageview',
                batching: true,
            })

            posthog._handle_unload()

            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('does capture $pageleave when capture_pageview=false and capture_pageleave=true', () => {
            const posthog = posthogWith({
                capture_pageview: false,
                capture_pageleave: true,
                batching: true,
            })

            posthog._handle_unload()

            expect(posthog.capture).toHaveBeenCalledWith('$pageleave')
        })

        it('calls requestQueue unload', () => {
            const posthog = posthogWith({
                capture_pageview: true,
                capture_pageleave: 'if_capture_pageview',
                batching: true,
            })

            posthog._handle_unload()

            expect(posthog._requestQueue.unload).toHaveBeenCalledTimes(1)
        })

        describe('without batching', () => {
            given('batching', () => false)

            it('captures $pageleave', () => {
                const posthog = posthogWith({
                    capture_pageview: true,
                    capture_pageleave: 'if_capture_pageview',
                    request_batching: false,
                })
                posthog._handle_unload()

                expect(posthog.capture).toHaveBeenCalledWith('$pageleave', null, { transport: 'sendBeacon' })
            })

            it('does not capture $pageleave when capture_pageview=false', () => {
                const posthog = posthogWith({
                    capture_pageview: false,
                    capture_pageleave: 'if_capture_pageview',
                    request_batching: false,
                })
                posthog._handle_unload()

                expect(posthog.capture).not.toHaveBeenCalled()
            })
        })
    })

    describe('bootstrapping feature flags', () => {
        const posthogWith = (config) => {
            const posthog = defaultPostHog().init('testtoken', config, uuidv7())
            posthog._send_request = jest.fn()
            posthog.capture = jest.fn()
            return posthog
        }

        it('sets the right distinctID', () => {
            const posthog = posthogWith({
                bootstrap: {
                    distinctID: 'abcd',
                },
            })

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
            const posthog = posthogWith({
                bootstrap: {
                    distinctID: 'abcd',
                    isIdentifiedID: true,
                },
                get_device_id: () => 'og-device-id',
            })

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
                        undef: undefined,
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
                        undef: undefined,
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
            jest.spyOn(console, 'warn').mockImplementation()

            const posthog = posthogWith({
                bootstrap: {},
            })

            expect(posthog.get_distinct_id()).not.toBe('abcd')
            expect(posthog.get_distinct_id()).not.toEqual(undefined)
            expect(posthog.getFeatureFlag('multivariant')).toBe(undefined)
            expect(console.warn).toHaveBeenCalledWith(
                '[PostHog.js]',
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
            const fakeOnXHRError = 'configured error'
            const posthog = defaultPostHog().init(
                'a-token',
                {
                    on_xhr_error: fakeOnXHRError,
                },
                'a-name'
            )
            expect(posthog.config.on_xhr_error).toBe(fakeOnXHRError)
        })

        it('does not load feature flags, toolbar, session recording', () => {
            const posthog = defaultPostHog().init('testtoken', given.config, uuidv7())

            posthog.toolbar = {
                maybeLoadToolbar: jest.fn(),
                afterDecideResponse: jest.fn(),
            }
            posthog.sessionRecording = {
                afterDecideResponse: jest.fn(),
                startIfEnabledOrStop: jest.fn(),
            }
            posthog.persistence = {
                register: jest.fn(),
                update_config: jest.fn(),
            }

            // Feature flags
            expect(posthog.persistence.register).not.toHaveBeenCalled() // FFs are saved this way

            // Toolbar
            expect(posthog.toolbar.afterDecideResponse).not.toHaveBeenCalled()

            // Session recording
            expect(posthog.sessionRecording.afterDecideResponse).not.toHaveBeenCalled()
        })

        describe('device id behavior', () => {
            let uninitialisedPostHog
            beforeEach(() => {
                uninitialisedPostHog = defaultPostHog()
            })

            it('sets a random UUID as distinct_id/$device_id if distinct_id is unset', () => {
                uninitialisedPostHog.persistence = { props: { distinct_id: undefined } }
                const posthog = uninitialisedPostHog.init(
                    'testtoken',
                    {
                        get_device_id: (uuid) => uuid,
                    },
                    uuidv7()
                )

                expect(posthog.persistence.props).toMatchObject({
                    $device_id: expect.stringMatching(/^[0-9a-f-]+$/),
                    distinct_id: expect.stringMatching(/^[0-9a-f-]+$/),
                })

                expect(posthog.persistence.props.$device_id).toEqual(posthog.persistence.props.distinct_id)
            })

            it('does not set distinct_id/$device_id if distinct_id is unset', () => {
                uninitialisedPostHog.persistence = { props: { distinct_id: 'existing-id' } }
                const posthog = uninitialisedPostHog.init(
                    'testtoken',
                    {
                        get_device_id: (uuid) => uuid,
                    },
                    uuidv7()
                )

                expect(posthog.persistence.props.distinct_id).not.toEqual('existing-id')
            })

            it('uses config.get_device_id for uuid generation if passed', () => {
                uninitialisedPostHog.persistence = { props: { distinct_id: undefined } }
                const posthog = uninitialisedPostHog.init(
                    'testtoken',
                    {
                        get_device_id: (uuid) => 'custom-' + uuid.slice(0, 8),
                    },
                    uuidv7()
                )

                expect(posthog.persistence.props).toMatchObject({
                    $device_id: expect.stringMatching(/^custom-[0-9a-f-]+$/),
                    distinct_id: expect.stringMatching(/^custom-[0-9a-f-]+$/),
                })
            })
        })
    })

    describe('skipped init()', () => {
        it('capture() does not throw', () => {
            console.error = jest.fn()
            expect(() => defaultPostHog().capture('$pageview')).not.toThrow()
            expect(console.error).toHaveBeenCalledWith(
                '[PostHog.js]',
                'You must initialize PostHog before calling posthog.capture'
            )
        })
    })

    describe('group()', () => {
        let posthog

        beforeEach(() => {
            posthog = defaultPostHog().init(
                'testtoken',
                {
                    persistence: 'memory',
                },
                uuidv7()
            )
            posthog.persistence.clear()
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

            expect(posthog.persistence.props['$stored_group_properties']).toEqual({
                organization: { name: 'PostHog' },
            })

            posthog.group('organization', 'org::6')
            expect(posthog.getGroups()).toEqual({ organization: 'org::6' })
            expect(posthog.persistence.props['$stored_group_properties']).toEqual({ organization: {} })

            posthog.group('instance', 'app.posthog.com')
            expect(posthog.getGroups()).toEqual({ organization: 'org::6', instance: 'app.posthog.com' })
            expect(posthog.persistence.props['$stored_group_properties']).toEqual({ organization: {}, instance: {} })

            // now add properties to the group
            posthog.group('organization', 'org::7', { name: 'PostHog2' })
            expect(posthog.getGroups()).toEqual({ organization: 'org::7', instance: 'app.posthog.com' })
            expect(posthog.persistence.props['$stored_group_properties']).toEqual({
                organization: { name: 'PostHog2' },
                instance: {},
            })

            posthog.group('instance', 'app.posthog.com', { a: 'b' })
            expect(posthog.getGroups()).toEqual({ organization: 'org::7', instance: 'app.posthog.com' })
            expect(posthog.persistence.props['$stored_group_properties']).toEqual({
                organization: { name: 'PostHog2' },
                instance: { a: 'b' },
            })

            posthog.resetGroupPropertiesForFlags()
            expect(posthog.persistence.props['$stored_group_properties']).toEqual(undefined)
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
                )
                posthog.persistence.clear()
                // mock this internal queue - not capture
                posthog._requestQueue = {
                    enqueue: jest.fn(),
                }
            })

            it('sends group information in event properties', () => {
                posthog.group('organization', 'org::5')
                posthog.group('instance', 'app.posthog.com')

                posthog.capture('some_event', { prop: 5 })

                expect(posthog._requestQueue.enqueue).toHaveBeenCalledTimes(1)

                const eventPayload = posthog._requestQueue.enqueue.mock.calls[0][0]
                expect(eventPayload.data.event).toEqual('some_event')
                expect(eventPayload.data.properties.$groups).toEqual({
                    organization: 'org::5',
                    instance: 'app.posthog.com',
                })
            })
        })

        describe('error handling', () => {
            given('overrides', () => ({
                register: jest.fn(),
            }))

            it('handles blank keys being passed', () => {
                window.console.error = jest.fn()
                window.console.warn = jest.fn()

                posthog.group(null, 'foo')
                posthog.group('organization', null)
                posthog.group('organization', undefined)
                posthog.group('organization', '')
                posthog.group('', 'foo')

                expect(given.overrides.register).not.toHaveBeenCalled()
            })
        })

        describe('reset group', () => {
            it('groups property is empty and reloads feature flags', () => {
                posthog.group('organization', 'org::5')
                posthog.group('instance', 'app.posthog.com', { group: 'property', foo: 5 })

                expect(posthog.persistence.props['$groups']).toEqual({
                    organization: 'org::5',
                    instance: 'app.posthog.com',
                })

                expect(posthog.persistence.props['$stored_group_properties']).toEqual({
                    organization: {},
                    instance: {
                        group: 'property',
                        foo: 5,
                    },
                })

                posthog.resetGroups()

                expect(posthog.persistence.props['$groups']).toEqual({})
                expect(posthog.persistence.props['$stored_group_properties']).toEqual(undefined)

                expect(posthog.reloadFeatureFlags).toHaveBeenCalledTimes(3)
            })
        })
    })

    describe('_loaded()', () => {
        given('subject', () => () => given.lib._loaded())

        given('overrides', () => ({
            config: given.config,
            capture: jest.fn(),
            featureFlags: {
                setReloadingPaused: jest.fn(),
                resetRequestQueue: jest.fn(),
                _startReloadTimer: jest.fn(),
            },
            _start_queue_if_opted_in: jest.fn(),
        }))
        given('config', () => ({ loaded: jest.fn() }))

        it('calls loaded config option', () => {
            given.subject()

            expect(given.config.loaded).toHaveBeenCalledWith(given.lib)
        })

        it('handles loaded config option throwing gracefully', () => {
            given('config', () => ({
                loaded: () => {
                    throw Error()
                },
            }))
            console.error = jest.fn()

            given.subject()

            expect(console.error).toHaveBeenCalledWith('[PostHog.js]', '`loaded` function failed', expect.anything())
        })

        describe('/decide', () => {
            beforeEach(() => {
                const call = jest.fn()
                Decide.mockImplementation(() => ({ call }))
            })

            afterEach(() => {
                Decide.mockReset()
            })

            it('is called by default', async () => {
                const instance = await createPosthogInstance(uuidv7())
                instance.featureFlags.setReloadingPaused = jest.fn()
                instance._loaded()

                expect(new Decide().call).toHaveBeenCalled()
                expect(instance.featureFlags.setReloadingPaused).toHaveBeenCalledWith(true)
            })

            it('does not call decide if disabled', async () => {
                const instance = await createPosthogInstance(uuidv7(), {
                    advanced_disable_decide: true,
                })
                instance.featureFlags.setReloadingPaused = jest.fn()
                instance._loaded()

                expect(new Decide().call).not.toHaveBeenCalled()
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
        let instance
        let token

        beforeEach(async () => {
            token = uuidv7()
            instance = await createPosthogInstance(token, {
                api_host: 'https://us.posthog.com',
            })
            instance.sessionManager.checkAndGetSessionAndWindowId = jest.fn().mockReturnValue({
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
