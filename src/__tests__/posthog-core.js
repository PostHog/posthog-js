import { init_as_module, PostHog } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'
import { CaptureMetrics } from '../capture-metrics'
import { Decide } from '../decide'
import { autocapture } from '../autocapture'
import { _info } from '../utils'
import { truth } from './helpers/truth'

jest.mock('../gdpr-utils', () => ({
    ...jest.requireActual('../gdpr-utils'),
    addOptOutCheck: (fn) => fn,
}))
jest.mock('../decide')

given('lib', () => Object.assign(new PostHog(), given.overrides))

describe('capture()', () => {
    given('eventName', () => '$event')

    given(
        'subject',
        () => () => given.lib.capture(given.eventName, given.eventProperties, given.options, given.callback)
    )

    given('config', () => ({
        property_blacklist: [],
        _onCapture: jest.fn(),
    }))

    given('overrides', () => ({
        __loaded: true,
        get_config: (key) => given.config?.[key],
        config: given.config,
        persistence: {
            remove_event_timer: jest.fn(),
            update_search_keyword: jest.fn(),
            update_campaign_params: jest.fn(),
            properties: jest.fn(),
        },
        compression: {},
        _captureMetrics: new CaptureMetrics(),
        __captureHooks: [],
    }))

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

    it('errors with undefined event name', () => {
        given('eventName', () => undefined)
        console.error = jest.fn()

        const hook = jest.fn()
        given.lib._addCaptureHook(hook)

        expect(() => given.subject()).not.toThrow()
        expect(hook).not.toHaveBeenCalled()
        expect(console.error).toHaveBeenCalledWith('No event name provided to posthog.capture')
    })

    it('errors with object event name', () => {
        given('eventName', () => ({ event: 'object as name' }))
        console.error = jest.fn()

        const hook = jest.fn()
        given.lib._addCaptureHook(hook)

        expect(() => given.subject()).not.toThrow()
        expect(hook).not.toHaveBeenCalled()
        expect(console.error).toHaveBeenCalledWith('No event name provided to posthog.capture')
    })

    it('truncates long properties', () => {
        given('config', () => ({
            properties_string_max_length: 1000,
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
            property_blacklist: [],
            _onCapture: jest.fn(),
        }))
        given('eventProperties', () => ({
            key: 'value'.repeat(10000),
        }))
        const event = given.subject()
        expect(event.properties.key.length).toBe(50000)
    })
})

describe('_calculate_event_properties()', () => {
    given('subject', () =>
        given.lib._calculate_event_properties(given.event_name, given.properties, given.start_timestamp, given.options)
    )

    given('event_name', () => 'custom_event')
    given('properties', () => ({ event: 'prop' }))

    given('options', () => ({}))

    given('overrides', () => ({
        get_config: (key) => given.config[key],
        persistence: {
            properties: () => ({ distinct_id: 'abc', persistent: 'prop' }),
            remove_event_timer: jest.fn(),
        },
        sessionManager: {
            checkAndGetSessionAndWindowId: jest.fn().mockReturnValue({
                windowId: 'windowId',
                sessionId: 'sessionId',
            }),
        },
    }))

    given('config', () => ({
        token: 'testtoken',
        property_blacklist: given.property_blacklist,
        sanitize_properties: given.sanitize_properties,
    }))
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

    it('respects property_blacklist', () => {
        given('property_blacklist', () => ['$lib', 'persistent'])

        expect(given.subject).toEqual({
            token: 'testtoken',
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
})

describe('_handle_unload()', () => {
    given('subject', () => () => given.lib._handle_unload())

    given('overrides', () => ({
        get_config: (key) => given.config[key],
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

describe('__compress_and_send_json_request', () => {
    given(
        'subject',
        () => () => given.lib.__compress_and_send_json_request('/e/', given.jsonData, given.options, jest.fn())
    )

    given('jsonData', () => JSON.stringify({ large_key: new Array(500).join('abc') }))

    given('overrides', () => ({
        compression: {},
        _send_request: jest.fn(),
        get_config: () => false,
    }))

    it('handles base64 compression', () => {
        given('compression', () => ({}))

        given.subject()

        expect(given.overrides._send_request.mock.calls).toMatchSnapshot()
    })
})

describe('bootstrapping feature flags', () => {
    given('subject', () => () => given.lib._init('posthog', given.config, 'testhog'))

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

        given.subject()
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

        given.subject()
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

        given.subject()
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

        given.subject()
        expect(given.lib.getFeatureFlagPayload('multivariant')).toBe('some-payload')
        expect(given.lib.getFeatureFlagPayload('enabled')).toEqual({ another: 'value' })
        expect(given.lib.getFeatureFlagPayload('jsonString')).toEqual({ a: 'payload' })
        expect(given.lib.getFeatureFlagPayload('disabled')).toBe(undefined)
        expect(given.lib.getFeatureFlagPayload('undef')).toBe(undefined)
    })

    it('does nothing when empty', () => {
        given('config', () => ({
            bootstrap: {},
        }))

        given.subject()
        expect(given.lib.get_distinct_id()).not.toBe('abcd')
        expect(given.lib.get_distinct_id()).not.toEqual(undefined)
        expect(given.lib.getFeatureFlag('multivariant')).toBe(undefined)
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

        given.subject()
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

        given.subject()
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

        given.subject()
        given.lib.featureFlags.onFeatureFlags(() => (called = true))
        expect(called).toEqual(false)
    })
})

describe('init()', () => {
    let windowSpy = jest.spyOn(window, 'window', 'get')
    given('subject', () => () => given.lib._init('posthog', given.config, 'testhog'))

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
        init_as_module()
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
        expect(given.subject.get_config('on_xhr_error')).toBe(fakeOnXHRError)
    })

    it('does not load decide endpoint on advanced_disable_decide', () => {
        given.subject()
        expect(given.decide).toBe(undefined)
        expect(given.overrides._send_request.mock.calls.length).toBe(0) // No outgoing requests
    })

    it('does not set __loaded_recorder_version flag if recording script has not been included', () => {
        given('overrides', () => ({
            __loaded_recorder_version: undefined,
        }))
        delete window.rrweb
        window.rrweb = { record: undefined }
        delete window.rrwebRecord
        window.rrwebRecord = undefined
        given.subject()
        expect(given.lib.__loaded_recorder_version).toEqual(undefined)
    })

    it('set __loaded_recorder_version flag to v1 if recording script has been included', () => {
        given('overrides', () => ({
            __loaded_recorder_version: undefined,
        }))
        delete window.rrweb
        window.rrweb = { record: 'anything', version: '1.1.3' }
        delete window.rrwebRecord
        window.rrwebRecord = 'is possible'
        given.subject()
        expect(given.lib.__loaded_recorder_version).toMatch(new RegExp(`^1\.?`)) // start with 1.?.?
    })

    it('set __loaded_recorder_version flag to v1 if recording script has been included', () => {
        given('overrides', () => ({
            __loaded_recorder_version: undefined,
        }))
        delete window.rrweb
        window.rrweb = { record: 'anything', version: '2.0.0-alpha.5' }
        delete window.rrwebRecord
        window.rrwebRecord = 'is possible'
        given.subject()
        expect(given.lib.__loaded_recorder_version).toMatch(new RegExp(`^2\.?`)) // start with 2.?.?
    })

    it('does not load autocapture, feature flags, toolbar, session recording or compression', () => {
        given('overrides', () => ({
            sessionRecording: {
                afterDecideResponse: jest.fn(),
                startRecordingIfEnabled: jest.fn(),
            },
            toolbar: {
                afterDecideResponse: jest.fn(),
            },
            persistence: {
                register: jest.fn(),
                update_config: jest.fn(),
            },
        }))

        given.subject()

        jest.spyOn(given.lib.toolbar, 'afterDecideResponse').mockImplementation()
        jest.spyOn(given.lib.sessionRecording, 'afterDecideResponse').mockImplementation()
        jest.spyOn(given.lib.persistence, 'register').mockImplementation()

        // Autocapture
        expect(given.lib.__autocapture).toEqual(undefined)
        expect(autocapture.init).not.toHaveBeenCalled()
        expect(autocapture.afterDecideResponse).not.toHaveBeenCalled()

        // Feature flags
        expect(given.lib.persistence.register).not.toHaveBeenCalled() // FFs are saved this way

        // Toolbar
        expect(given.lib.toolbar.afterDecideResponse).not.toHaveBeenCalled()

        // Session recording
        expect(given.lib.sessionRecording.afterDecideResponse).not.toHaveBeenCalled()

        // Compression
        expect(given.lib['compression']).toEqual({})
    })

    describe('device id behavior', () => {
        it('sets a random UUID as distinct_id/$device_id if distinct_id is unset', () => {
            given('distinct_id', () => undefined)

            given.subject()

            expect(given.lib.register_once).toHaveBeenCalledWith(
                {
                    $device_id: truth((val) => val.match(/^[0-9a-f\-]+$/)),
                    distinct_id: truth((val) => val.match(/^[0-9a-f\-]+$/)),
                },
                ''
            )
        })

        it('does not set distinct_id/$device_id if distinct_id is unset', () => {
            given('distinct_id', () => 'existing-id')

            given.subject()

            expect(given.lib.register_once).not.toHaveBeenCalled()
        })

        it('uses config.get_device_id for uuid generation if passed', () => {
            given('distinct_id', () => undefined)
            given('config', () => ({
                get_device_id: (uuid) => 'custom-' + uuid.slice(0, 8),
            }))

            given.subject()

            expect(given.lib.register_once).toHaveBeenCalledWith(
                {
                    $device_id: truth((val) => val.match(/^custom\-[0-9a-f]+/)),
                    distinct_id: truth((val) => val.match(/^custom\-[0-9a-f]+/)),
                },
                ''
            )
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

    it('does not result in a capture call', () => {
        given.lib.group('organization', 'org::5')

        expect(given.overrides.capture).not.toHaveBeenCalled()
    })

    it('results in a reloadFeatureFlags call if group changes', () => {
        given.lib.group('organization', 'org::5')
        given.lib.group('instance', 'app.posthog.com')
        given.lib.group('organization', 'org::5')

        expect(given.overrides.reloadFeatureFlags).toHaveBeenCalledTimes(2)
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
            config: given.config,
            persistence: new PostHogPersistence(given.config),
            _requestQueue: {
                enqueue: given.captureQueue,
            },
            _captureMetrics: {
                incr: jest.fn(),
            },
            reloadFeatureFlags: jest.fn(),
        }))

        it('sends group information in event properties', () => {
            given.lib.group('organization', 'org::5')
            given.lib.group('instance', 'app.posthog.com')

            given.lib.capture('some_event', { prop: 5 })

            expect(given.captureQueue).toHaveBeenCalledTimes(1)

            const [, eventPayload] = given.captureQueue.mock.calls[0]
            expect(eventPayload.event).toEqual('some_event')
            expect(eventPayload.properties.$groups).toEqual({
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
            given.lib.group('instance', 'app.posthog.com')

            expect(given.lib.persistence.props['$groups']).toEqual({
                organization: 'org::5',
                instance: 'app.posthog.com',
            })

            given.lib.resetGroups()

            expect(given.lib.persistence.props['$groups']).toEqual({})

            expect(given.overrides.reloadFeatureFlags).toHaveBeenCalledTimes(3)
        })
    })
})

describe('_loaded()', () => {
    given('subject', () => () => given.lib._loaded())

    given('overrides', () => ({
        get_config: (key) => given.config?.[key],
        capture: jest.fn(),
        featureFlags: {
            setReloadingPaused: jest.fn(),
            resetRequestQueue: jest.fn(),
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

        expect(console.error).toHaveBeenCalledWith('`loaded` function failed', expect.anything())
    })

    describe('/decide', () => {
        beforeEach(() => {
            const call = jest.fn()
            Decide.mockImplementation(() => ({ call }))
        })

        it('is called by default', () => {
            given.subject()

            expect(new Decide().call).toHaveBeenCalled()
        })

        it('does not call decide if disabled', () => {
            given('config', () => ({
                advanced_disable_decide: true,
                loaded: jest.fn(),
            }))

            given.subject()

            expect(new Decide().call).not.toHaveBeenCalled()
        })
    })

    describe('capturing pageviews', () => {
        it('captures not capture pageview if disabled', () => {
            given('config', () => ({
                capture_pageview: false,
                loaded: jest.fn(),
            }))

            given.subject()

            expect(given.overrides.capture).not.toHaveBeenCalled()
        })

        it('captures pageview if enabled', () => {
            given('config', () => ({
                capture_pageview: true,
                loaded: jest.fn(),
            }))

            given.subject()

            expect(given.overrides.capture).toHaveBeenCalledWith('$pageview', {}, { send_instantly: true })
        })
    })

    it('toggles feature flags on and off', () => {
        given.subject()

        expect(given.overrides.featureFlags.setReloadingPaused).toHaveBeenCalledWith(true)
        expect(given.overrides.featureFlags.setReloadingPaused).toHaveBeenCalledWith(false)
        expect(given.overrides.featureFlags.resetRequestQueue).toHaveBeenCalled()
    })
})
