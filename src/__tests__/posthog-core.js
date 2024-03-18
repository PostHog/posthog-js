import _posthog from '../loader-module'
import { PostHogPersistence } from '../posthog-persistence'
import { Decide } from '../decide'
import { autocapture } from '../autocapture'

import { _info } from '../utils/event-utils'
import { document, window } from '../utils/globals'
import { uuidv7 } from '../uuidv7'
import * as globals from '../utils/globals'

jest.mock('../gdpr-utils', () => ({
    ...jest.requireActual('../gdpr-utils'),
    addOptOutCheck: (fn) => fn,
}))
jest.mock('../decide')

describe('posthog core', () => {
    const baseUTCDateTime = new Date(Date.UTC(2020, 0, 1, 0, 0, 0))

    given('lib', () => {
        const posthog = _posthog.init('testtoken', given.config, uuidv7())
        posthog.debug()
        return Object.assign(posthog, given.overrides)
    })

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
            },
            sessionPersistence: {
                update_search_keyword: jest.fn(),
                update_campaign_params: jest.fn(),
                update_referrer_info: jest.fn(),
                update_config: jest.fn(),
                properties: jest.fn(),
            },
            _send_request: jest.fn(),
            compression: {},
            __captureHooks: [],
            rateLimiter: {
                isRateLimited: () => false,
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

            expect(hook).toHaveBeenCalledWith('$event')
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
            expect(hook).toHaveBeenCalledWith('$event')
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

        it('enables elementsChainAsString if given', () => {
            given('decideResponse', () => ({ elementsChainAsString: true }))
            given.subject()

            expect(given.lib.elementsChainAsString).toBe(true)
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
                properties: () => ({ distinct_id: 'abc', persistent: 'prop' }),
                remove_event_timer: jest.fn(),
            },
            sessionPersistence: {
                properties: () => ({ distinct_id: 'abc', persistent: 'prop' }),
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
            jest.spyOn(_info, 'properties').mockReturnValue({ $lib: 'web' })
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
            })
        })

        it('respects property_denylist and property_blacklist', () => {
            given('property_denylist', () => ['$lib', 'persistent'])
            given('property_blacklist', () => ['token'])

            expect(given.subject).toEqual({
                event: 'prop',
                distinct_id: 'abc',
                $window_id: 'windowId',
                $session_id: 'sessionId',
            })
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

        it('only adds a few propertes if event is $performance_event', () => {
            given('event_name', () => '$performance_event')
            expect(given.subject).toEqual({
                distinct_id: 'abc',
                event: 'prop', // from actual mock event properties
                $current_url: undefined,
                $session_id: 'sessionId',
                $window_id: 'windowId',
                token: 'testtoken',
            })
        })

        it('calls sanitize_properties', () => {
            given('sanitize_properties', () => (props, event_name) => ({ token: props.token, event_name }))

            expect(given.subject).toEqual({
                event_name: given.event_name,
                token: 'testtoken',
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
            capture_pageview: given.capturePageviews,
            capture_pageleave: given.capturePageleave,
            request_batching: given.batching,
        }))

        given('capturePageviews', () => true)
        given('capturePageleave', () => true)
        given('batching', () => true)

        it('captures $pageleave', () => {
            given.subject()

            expect(given.overrides.capture).toHaveBeenCalledWith('$pageleave')
        })

        it('does not capture $pageleave when capture_pageview=false', () => {
            given('capturePageviews', () => false)

            given.subject()

            expect(given.overrides.capture).not.toHaveBeenCalled()
        })

        it('calls requestQueue unload', () => {
            given.subject()

            expect(given.overrides._requestQueue.unload).toHaveBeenCalledTimes(1)
        })

        describe('without batching', () => {
            given('batching', () => false)

            it('captures $pageleave', () => {
                given.subject()

                expect(given.overrides.capture).toHaveBeenCalledWith('$pageleave', null, { transport: 'sendBeacon' })
            })

            it('does not capture $pageleave when capture_pageview=false', () => {
                given('capturePageviews', () => false)

                given.subject()

                expect(given.overrides.capture).not.toHaveBeenCalled()
            })
        })
    })

    describe('bootstrapping feature flags', () => {
        given('overrides', () => ({
            _send_request: jest.fn(),
            capture: jest.fn(),
        }))

        afterEach(() => {
            given.lib.reset()
        })

        it('sets the right distinctID', () => {
            given('config', () => ({
                bootstrap: {
                    distinctID: 'abcd',
                },
            }))

            expect(given.lib.get_distinct_id()).toBe('abcd')
            expect(given.lib.get_property('$device_id')).toBe('abcd')
            expect(given.lib.persistence.get_user_state()).toBe('anonymous')

            given.lib.identify('efgh')

            expect(given.overrides.capture).toHaveBeenCalledWith(
                '$identify',
                {
                    distinct_id: 'efgh',
                    $anon_distinct_id: 'abcd',
                },
                { $set: {}, $set_once: {} }
            )
        })

        it('treats identified distinctIDs appropriately', () => {
            given('config', () => ({
                bootstrap: {
                    distinctID: 'abcd',
                    isIdentifiedID: true,
                },
                get_device_id: () => 'og-device-id',
            }))

            expect(given.lib.get_distinct_id()).toBe('abcd')
            expect(given.lib.get_property('$device_id')).toBe('og-device-id')
            expect(given.lib.persistence.get_user_state()).toBe('identified')

            given.lib.identify('efgh')
            expect(given.overrides.capture).not.toHaveBeenCalled()
        })

        it('sets the right feature flags', () => {
            given('config', () => ({
                bootstrap: {
                    featureFlags: { multivariant: 'variant-1', enabled: true, disabled: false, undef: undefined },
                },
            }))

            expect(given.lib.get_distinct_id()).not.toBe('abcd')
            expect(given.lib.get_distinct_id()).not.toEqual(undefined)
            expect(given.lib.getFeatureFlag('multivariant')).toBe('variant-1')
            expect(given.lib.getFeatureFlag('disabled')).toBe(undefined)
            expect(given.lib.getFeatureFlag('undef')).toBe(undefined)
            expect(given.lib.featureFlags.getFlagVariants()).toEqual({ multivariant: 'variant-1', enabled: true })
        })

        it('sets the right feature flag payloads', () => {
            given('config', () => ({
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
            }))

            expect(given.lib.getFeatureFlagPayload('multivariant')).toBe('some-payload')
            expect(given.lib.getFeatureFlagPayload('enabled')).toEqual({ another: 'value' })
            expect(given.lib.getFeatureFlagPayload('jsonString')).toEqual({ a: 'payload' })
            expect(given.lib.getFeatureFlagPayload('disabled')).toBe(undefined)
            expect(given.lib.getFeatureFlagPayload('undef')).toBe(undefined)
        })

        it('does nothing when empty', () => {
            jest.spyOn(console, 'warn').mockImplementation()

            given('config', () => ({
                bootstrap: {},
            }))

            expect(given.lib.get_distinct_id()).not.toBe('abcd')
            expect(given.lib.get_distinct_id()).not.toEqual(undefined)
            expect(given.lib.getFeatureFlag('multivariant')).toBe(undefined)
            expect(console.warn).toHaveBeenCalledWith(
                '[PostHog.js]',
                expect.stringContaining('getFeatureFlag for key "multivariant" failed')
            )
            expect(given.lib.getFeatureFlag('disabled')).toBe(undefined)
            expect(given.lib.getFeatureFlag('undef')).toBe(undefined)
            expect(given.lib.featureFlags.getFlagVariants()).toEqual({})
        })

        it('onFeatureFlags should be called immediately if feature flags are bootstrapped', () => {
            let called = false

            given('config', () => ({
                bootstrap: {
                    featureFlags: { multivariant: 'variant-1' },
                },
            }))

            given.lib.featureFlags.onFeatureFlags(() => (called = true))
            expect(called).toEqual(true)
        })

        it('onFeatureFlags should not be called immediately if feature flags bootstrap is empty', () => {
            let called = false

            given('config', () => ({
                bootstrap: {
                    featureFlags: {},
                },
            }))

            given.lib.featureFlags.onFeatureFlags(() => (called = true))
            expect(called).toEqual(false)
        })

        it('onFeatureFlags should not be called immediately if feature flags bootstrap is undefined', () => {
            let called = false

            given('config', () => ({
                bootstrap: {
                    featureFlags: undefined,
                },
            }))

            given.lib.featureFlags.onFeatureFlags(() => (called = true))
            expect(called).toEqual(false)
        })
    })

    describe('init()', () => {
        jest.spyOn(window, 'window', 'get')

        given('overrides', () => ({
            get_distinct_id: () => given.distinct_id,
            advanced_disable_decide: given.advanced_disable_decide,
            _send_request: jest.fn(),
            capture: jest.fn(),
            register_once: jest.fn(),
        }))

        beforeEach(() => {
            jest.spyOn(window.console, 'warn').mockImplementation()
            jest.spyOn(window.console, 'error').mockImplementation()
            jest.spyOn(autocapture, 'init').mockImplementation()
            jest.spyOn(autocapture, 'afterDecideResponse').mockImplementation()
        })

        given('advanced_disable_decide', () => true)

        it('can set an xhr error handler', () => {
            const fakeOnXHRError = 'configured error'
            given('subject', () =>
                given.lib.init(
                    'a-token',
                    {
                        on_xhr_error: fakeOnXHRError,
                    },
                    'a-name'
                )
            )
            expect(given.subject.config.on_xhr_error).toBe(fakeOnXHRError)
        })

        it('does not load decide endpoint on advanced_disable_decide', () => {
            expect(given.decide).toBe(undefined)
            expect(given.overrides._send_request.mock.calls.length).toBe(0) // No outgoing requests
        })

        it('does not set __loaded_recorder_version flag if recording script has not been included', () => {
            delete window.rrweb
            window.rrweb = { record: undefined }
            delete window.rrwebRecord
            window.rrwebRecord = undefined
            expect(given.lib.__loaded_recorder_version).toEqual(undefined)
        })

        it('set __loaded_recorder_version flag to v1 if recording script has been included', () => {
            delete window.rrweb
            window.rrweb = { record: 'anything', version: '1.1.3' }
            delete window.rrwebRecord
            window.rrwebRecord = 'is possible'
            expect(given.lib.__loaded_recorder_version).toMatch(/^1\./) // start with 1.?.?
        })

        it('set __loaded_recorder_version flag to v2 if recording script has been included', () => {
            delete window.rrweb
            window.rrweb = { record: 'anything', version: '2.0.0-alpha.6' }
            delete window.rrwebRecord
            window.rrwebRecord = 'is possible'
            expect(given.lib.__loaded_recorder_version).toMatch(/^2\./) // start with 2.?.?
        })

        it('does not load autocapture, feature flags, toolbar, session recording', () => {
            given('overrides', () => ({
                sessionRecording: {
                    afterDecideResponse: jest.fn(),
                    startRecordingIfEnabled: jest.fn(),
                },
                toolbar: {
                    maybeLoadToolbar: jest.fn(),
                    afterDecideResponse: jest.fn(),
                },
                persistence: {
                    register: jest.fn(),
                    update_config: jest.fn(),
                },
            }))

            jest.spyOn(given.lib.toolbar, 'afterDecideResponse').mockImplementation()
            jest.spyOn(given.lib.sessionRecording, 'afterDecideResponse').mockImplementation()
            jest.spyOn(given.lib.persistence, 'register').mockImplementation()

            // Autocapture
            expect(autocapture.afterDecideResponse).not.toHaveBeenCalled()

            // Feature flags
            expect(given.lib.persistence.register).not.toHaveBeenCalled() // FFs are saved this way

            // Toolbar
            expect(given.lib.toolbar.afterDecideResponse).not.toHaveBeenCalled()

            // Session recording
            expect(given.lib.sessionRecording.afterDecideResponse).not.toHaveBeenCalled()
        })

        describe('device id behavior', () => {
            it('sets a random UUID as distinct_id/$device_id if distinct_id is unset', () => {
                given('distinct_id', () => undefined)
                given('config', () => ({
                    get_device_id: (uuid) => uuid,
                }))

                expect(given.lib.persistence.props).toMatchObject({
                    $device_id: expect.stringMatching(/^[0-9a-f-]+$/),
                    distinct_id: expect.stringMatching(/^[0-9a-f-]+$/),
                })

                expect(given.lib.persistence.props.$device_id).toEqual(given.lib.persistence.props.distinct_id)
            })

            it('does not set distinct_id/$device_id if distinct_id is unset', () => {
                given('distinct_id', () => 'existing-id')

                expect(given.lib.persistence.props.distinct_id).not.toEqual('existing-id')
            })

            it('uses config.get_device_id for uuid generation if passed', () => {
                given('distinct_id', () => undefined)
                given('config', () => ({
                    get_device_id: (uuid) => 'custom-' + uuid.slice(0, 8),
                }))

                expect(given.lib.persistence.props).toMatchObject({
                    $device_id: expect.stringMatching(/^custom-[0-9a-f-]+$/),
                    distinct_id: expect.stringMatching(/^custom-[0-9a-f-]+$/),
                })
            })
        })
    })

    describe('skipped init()', () => {
        it('capture() does not throw', () => {
            expect(() => given.lib.capture('$pageview')).not.toThrow()
        })
    })

    describe('group()', () => {
        given('captureQueue', () => jest.fn())
        given('overrides', () => ({
            persistence: new PostHogPersistence(given.config),
            capture: jest.fn(),
            _captureMetrics: {
                incr: jest.fn(),
            },
            reloadFeatureFlags: jest.fn(),
        }))
        given('config', () => ({
            request_batching: true,
            persistence: 'memory',
            property_denylist: [],
            property_blacklist: [],
            _onCapture: jest.fn(),
        }))

        beforeEach(() => {
            given.overrides.persistence.clear()
        })

        it('records info on groups', () => {
            given.lib.group('organization', 'org::5')
            expect(given.lib.getGroups()).toEqual({ organization: 'org::5' })

            given.lib.group('organization', 'org::6')
            expect(given.lib.getGroups()).toEqual({ organization: 'org::6' })

            given.lib.group('instance', 'app.posthog.com')
            expect(given.lib.getGroups()).toEqual({ organization: 'org::6', instance: 'app.posthog.com' })
        })

        it('records info on groupProperties for groups', () => {
            given.lib.group('organization', 'org::5', { name: 'PostHog' })
            expect(given.lib.getGroups()).toEqual({ organization: 'org::5' })

            expect(given.lib.persistence.props['$stored_group_properties']).toEqual({
                organization: { name: 'PostHog' },
            })

            given.lib.group('organization', 'org::6')
            expect(given.lib.getGroups()).toEqual({ organization: 'org::6' })
            expect(given.lib.persistence.props['$stored_group_properties']).toEqual({ organization: {} })

            given.lib.group('instance', 'app.posthog.com')
            expect(given.lib.getGroups()).toEqual({ organization: 'org::6', instance: 'app.posthog.com' })
            expect(given.lib.persistence.props['$stored_group_properties']).toEqual({ organization: {}, instance: {} })

            // now add properties to the group
            given.lib.group('organization', 'org::7', { name: 'PostHog2' })
            expect(given.lib.getGroups()).toEqual({ organization: 'org::7', instance: 'app.posthog.com' })
            expect(given.lib.persistence.props['$stored_group_properties']).toEqual({
                organization: { name: 'PostHog2' },
                instance: {},
            })

            given.lib.group('instance', 'app.posthog.com', { a: 'b' })
            expect(given.lib.getGroups()).toEqual({ organization: 'org::7', instance: 'app.posthog.com' })
            expect(given.lib.persistence.props['$stored_group_properties']).toEqual({
                organization: { name: 'PostHog2' },
                instance: { a: 'b' },
            })

            given.lib.resetGroupPropertiesForFlags()
            expect(given.lib.persistence.props['$stored_group_properties']).toEqual(undefined)
        })

        it('does not result in a capture call', () => {
            given.lib.group('organization', 'org::5')

            expect(given.overrides.capture).not.toHaveBeenCalled()
        })

        it('results in a reloadFeatureFlags call if group changes', () => {
            given.lib.group('organization', 'org::5', { name: 'PostHog' })
            given.lib.group('instance', 'app.posthog.com')
            given.lib.group('organization', 'org::5')

            expect(given.overrides.reloadFeatureFlags).toHaveBeenCalledTimes(2)
        })

        it('results in a reloadFeatureFlags call if group properties change', () => {
            given.lib.group('organization', 'org::5')
            given.lib.group('instance', 'app.posthog.com')
            given.lib.group('organization', 'org::5', { name: 'PostHog' })
            given.lib.group('instance', 'app.posthog.com')

            expect(given.overrides.reloadFeatureFlags).toHaveBeenCalledTimes(3)
        })

        it('captures $groupidentify event', () => {
            given.lib.group('organization', 'org::5', { group: 'property', foo: 5 })

            expect(given.overrides.capture).toHaveBeenCalledWith('$groupidentify', {
                $group_type: 'organization',
                $group_key: 'org::5',
                $group_set: {
                    group: 'property',
                    foo: 5,
                },
            })
        })

        describe('subsequent capture calls', () => {
            given('overrides', () => ({
                __loaded: true,
                config: {
                    api_host: 'https://app.posthog.com',
                    ...given.config,
                },
                persistence: new PostHogPersistence(given.config),
                sessionPersistence: new PostHogPersistence(given.config),
                _requestQueue: {
                    enqueue: given.captureQueue,
                },
                reloadFeatureFlags: jest.fn(),
            }))

            it('sends group information in event properties', () => {
                given.lib.group('organization', 'org::5')
                given.lib.group('instance', 'app.posthog.com')

                given.lib.capture('some_event', { prop: 5 })

                expect(given.captureQueue).toHaveBeenCalledTimes(1)

                const eventPayload = given.captureQueue.mock.calls[0][0]
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

                given.lib.group(null, 'foo')
                given.lib.group('organization', null)
                given.lib.group('organization', undefined)
                given.lib.group('organization', '')
                given.lib.group('', 'foo')

                expect(given.overrides.register).not.toHaveBeenCalled()
            })
        })

        describe('reset group', () => {
            it('groups property is empty and reloads feature flags', () => {
                given.lib.group('organization', 'org::5')
                given.lib.group('instance', 'app.posthog.com', { group: 'property', foo: 5 })

                expect(given.lib.persistence.props['$groups']).toEqual({
                    organization: 'org::5',
                    instance: 'app.posthog.com',
                })

                expect(given.lib.persistence.props['$stored_group_properties']).toEqual({
                    organization: {},
                    instance: {
                        group: 'property',
                        foo: 5,
                    },
                })

                given.lib.resetGroups()

                expect(given.lib.persistence.props['$groups']).toEqual({})
                expect(given.lib.persistence.props['$stored_group_properties']).toEqual(undefined)

                expect(given.overrides.reloadFeatureFlags).toHaveBeenCalledTimes(3)
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

            it('is called by default', () => {
                given.subject()

                expect(new Decide().call).toHaveBeenCalled()
                expect(given.overrides.featureFlags.setReloadingPaused).toHaveBeenCalledWith(true)
            })

            it('does not call decide if disabled', () => {
                given('config', () => ({
                    advanced_disable_decide: true,
                    loaded: jest.fn(),
                }))

                given.subject()

                expect(new Decide().call).not.toHaveBeenCalled()
                expect(given.overrides.featureFlags.setReloadingPaused).not.toHaveBeenCalled()
            })
        })

        describe('capturing pageviews', () => {
            it('captures not capture pageview if disabled', async () => {
                given('config', () => ({
                    capture_pageview: false,
                    loaded: jest.fn(),
                }))

                given.subject()

                expect(given.overrides.capture).not.toHaveBeenCalled()
            })

            it('captures pageview if enabled', async () => {
                jest.useFakeTimers()
                given('config', () => ({
                    capture_pageview: true,
                    loaded: jest.fn(),
                }))

                given.subject()

                jest.runOnlyPendingTimers()

                expect(given.overrides.capture).toHaveBeenCalledWith(
                    '$pageview',
                    { title: 'test' },
                    { send_instantly: true }
                )
            })
        })
    })
    describe('session_id', () => {
        given('overrides', () => ({
            sessionManager: {
                checkAndGetSessionAndWindowId: jest.fn().mockReturnValue({
                    windowId: 'windowId',
                    sessionId: 'sessionId',
                    sessionStartTimestamp: new Date().getTime() - 30000,
                }),
            },
        }))
        it('returns the session_id', () => {
            expect(given.lib.get_session_id()).toEqual('sessionId')
        })

        it('returns the replay URL', () => {
            expect(given.lib.get_session_replay_url()).toEqual('https://app.posthog.com/replay/sessionId')
        })

        it('returns the replay URL including timestamp', () => {
            expect(given.lib.get_session_replay_url({ withTimestamp: true })).toEqual(
                'https://app.posthog.com/replay/sessionId?t=20' // default lookback is 10 seconds
            )

            expect(given.lib.get_session_replay_url({ withTimestamp: true, timestampLookBack: 0 })).toEqual(
                'https://app.posthog.com/replay/sessionId?t=30'
            )
        })
    })

    test('deprecated web performance observer still exposes _forceAllowLocalhost', () => {
        expect(given.lib.webPerformance._forceAllowLocalhost).toBe(false)
        expect(() => given.lib.webPerformance._forceAllowLocalhost).not.toThrow()
    })
})
