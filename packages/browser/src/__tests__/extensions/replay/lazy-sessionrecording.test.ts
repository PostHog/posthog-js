/// <reference lib="dom" />

import '@testing-library/jest-dom'

import { PostHogPersistence } from '../../../posthog-persistence'
import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_REMOTE_CONFIG,
} from '../../../constants'
import { SessionIdManager } from '../../../sessionid'
import { createMockPostHog, createMockConfig } from '../../helpers/posthog-instance'
import {
    FULL_SNAPSHOT_EVENT_TYPE,
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
} from '../../../extensions/replay/external/sessionrecording-utils'
import { PostHog } from '../../../posthog-core'
import {
    FlagsResponse,
    PerformanceCaptureConfig,
    PostHogConfig,
    Property,
    SessionIdChangedCallback,
    SessionRecordingOptions,
} from '../../../types'
import { uuidv7 } from '../../../uuidv7'
import { assignableWindow, window } from '../../../utils/globals'
import { RequestRouter } from '../../../utils/request-router'
import {
    type customEvent,
    EventType,
    type eventWithTime,
    type fullSnapshotEvent,
    type incrementalData,
    type incrementalSnapshotEvent,
    IncrementalSource,
    type metaEvent,
    type pluginEvent,
} from '../../../extensions/replay/types/rrweb-types'
import { ConsentManager } from '../../../consent'
import { SimpleEventEmitter } from '../../../utils/simple-event-emitter'
import Mock = jest.Mock
import { SessionRecording } from '../../../extensions/replay/session-recording'
import {
    LazyLoadedSessionRecording,
    RECORDING_IDLE_THRESHOLD_MS,
    RECORDING_MAX_EVENT_SIZE,
} from '../../../extensions/replay/external/lazy-loaded-session-recorder'

// Type and source defined here designate a non-user-generated recording event

jest.mock('../../../config', () => ({ LIB_VERSION: '0.0.1' }))

const mockRemoteConfigLoad = jest.fn()
jest.mock('../../../remote-config', () => ({
    RemoteConfigLoader: jest.fn().mockImplementation(() => ({
        load: mockRemoteConfigLoad,
    })),
}))

const EMPTY_BUFFER = {
    data: [],
    sessionId: null,
    size: 0,
    windowId: null,
}

const createMetaSnapshot = (event = {}): metaEvent =>
    ({
        type: META_EVENT_TYPE,
        data: {
            href: 'https://has-to-be-present-or-invalid.com',
        },
        ...event,
    }) as metaEvent

const createStyleSnapshot = (event = {}): incrementalSnapshotEvent =>
    ({
        type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
        data: {
            source: IncrementalSource.StyleDeclaration,
        },
        ...event,
    }) as incrementalSnapshotEvent

const createFullSnapshot = (event = {}): fullSnapshotEvent =>
    ({
        type: FULL_SNAPSHOT_EVENT_TYPE,
        data: {},
        ...event,
    }) as fullSnapshotEvent

const createIncrementalSnapshot = (event = {}): incrementalSnapshotEvent => ({
    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    data: {
        source: 1,
    } as Partial<incrementalData> as incrementalData,
    ...event,
})

const createIncrementalMouseEvent = () => {
    return createIncrementalSnapshot({
        data: {
            source: 2,
            positions: [
                {
                    id: 1,
                    x: 100,
                    y: 200,
                    timeOffset: 100,
                },
            ],
        },
    })
}

const createIncrementalMutationEvent = (mutations?: { texts: any[] }) => {
    const mutationData = {
        texts: mutations?.texts || [],
        attributes: [],
        removes: [],
        adds: [],
        isAttachIframe: true,
    }
    return createIncrementalSnapshot({
        data: {
            source: 0,
            ...mutationData,
        },
    })
}

const createIncrementalStyleSheetEvent = (mutations?: { adds: any[] }) => {
    return createIncrementalSnapshot({
        data: {
            // doesn't need to be a valid style sheet event
            source: 8,
            id: 1,
            styleId: 1,
            removes: [],
            adds: mutations.adds || [],
            replace: 'something',
            replaceSync: 'something',
        },
    })
}

const createCustomSnapshot = (event = {}, payload = {}, tag: string = 'custom'): customEvent => ({
    type: EventType.Custom,
    data: {
        tag: tag,
        payload: {
            ...payload,
        },
    },
    ...event,
})

const createPluginSnapshot = (event = {}): pluginEvent => ({
    type: EventType.Plugin,
    data: {
        plugin: 'plugin',
        payload: {},
    },
    ...event,
})

function makeFlagsResponse(partialResponse: Partial<FlagsResponse>) {
    return partialResponse as unknown as FlagsResponse
}

const originalLocation = window!.location

function fakeNavigateTo(href: string) {
    delete (window as any).location
    // @ts-expect-error this is a test, it's safe to write to location like this
    window!.location = { href } as Location
}

describe('Lazy SessionRecording', () => {
    const _addCustomEvent = jest.fn()
    const loadScriptMock = jest.fn()
    let _emit: any
    let posthog: PostHog
    let sessionRecording: SessionRecording
    let sessionId: string
    let sessionManager: SessionIdManager
    let config: PostHogConfig
    let sessionIdGeneratorMock: Mock
    let windowIdGeneratorMock: Mock
    let onFeatureFlagsCallback: ((flags: string[], variants: Record<string, string | boolean>) => void) | null
    let removePageviewCaptureHookMock: Mock
    let simpleEventEmitter: SimpleEventEmitter

    const addRRwebToWindow = () => {
        assignableWindow.__PosthogExtensions__.rrweb = {
            record: jest.fn(({ emit }) => {
                _emit = emit
                return () => {}
            }),
            version: 'fake',
        }
        assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot = jest.fn(() => {
            // we pretend to be rrweb and call emit
            _emit(createFullSnapshot())
        })
        assignableWindow.__PosthogExtensions__.rrweb.record.addCustomEvent = _addCustomEvent

        assignableWindow.__PosthogExtensions__.rrwebPlugins = {
            getRecordConsolePlugin: jest.fn(),
        }

        assignableWindow.__PosthogExtensions__.initSessionRecording = () => {
            return new LazyLoadedSessionRecording(posthog)
        }
    }

    beforeEach(() => {
        mockRemoteConfigLoad.mockClear()
        removePageviewCaptureHookMock = jest.fn()
        sessionId = 'sessionId' + uuidv7()

        config = createMockConfig({
            api_host: 'https://test.com',
            disable_session_recording: false,
            enable_recording_console_log: false,
            autocapture: false, // Assert that session recording works even if `autocapture = false`
            session_recording: {
                maskAllInputs: false,
                // not the default but makes for easier test assertions
                compress_events: false,
            },
            persistence: 'memory',
        })

        assignableWindow.__PosthogExtensions__ = {
            rrweb: undefined,
            rrwebPlugins: {
                getRecordConsolePlugin: undefined,
                getRecordNetworkPlugin: undefined,
            },
        }

        sessionIdGeneratorMock = jest.fn().mockImplementation(() => sessionId)
        windowIdGeneratorMock = jest.fn().mockImplementation(() => 'windowId')

        const postHogPersistence = new PostHogPersistence(config)
        postHogPersistence.clear()

        sessionManager = new SessionIdManager(
            createMockPostHog({ config, persistence: postHogPersistence, register: jest.fn() }),
            sessionIdGeneratorMock,
            windowIdGeneratorMock
        )

        simpleEventEmitter = new SimpleEventEmitter()
        // TODO we really need to make this a real posthog instance :cry:
        posthog = {
            get_property: (property_key: string): Property | undefined => {
                return postHogPersistence?.props[property_key]
            },
            config: config,
            capture: jest.fn(),
            persistence: postHogPersistence,
            onFeatureFlags: (
                cb: (flags: string[], variants: Record<string, string | boolean>) => void
            ): (() => void) => {
                onFeatureFlagsCallback = cb
                return () => {}
            },
            sessionManager: sessionManager,
            requestRouter: new RequestRouter({ config } as any),
            consent: {
                isOptedOut(): boolean {
                    return false
                },
            } as unknown as ConsentManager,
            register_for_session() {},
            _internalEventEmitter: simpleEventEmitter,
            on: jest.fn().mockImplementation((event, cb) => {
                const unsubscribe = simpleEventEmitter.on(event, cb)
                return removePageviewCaptureHookMock.mockImplementation(unsubscribe)
            }),
        } as Partial<PostHog> as PostHog

        loadScriptMock.mockImplementation((_ph, _path, callback) => {
            addRRwebToWindow()
            callback()
        })

        assignableWindow.__PosthogExtensions__.loadExternalDependency = loadScriptMock

        // defaults
        posthog.persistence?.register({
            [SESSION_RECORDING_ENABLED_SERVER_SIDE]: true,
            [CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: false,
            [SESSION_RECORDING_IS_SAMPLED]: undefined,
        })

        sessionRecording = new SessionRecording(posthog)
    })

    afterEach(() => {
        // @ts-expect-error this is a test, it's safe to write to location like this
        window!.location = originalLocation
    })

    describe('before remote cofig', () => {
        it('is not enabled no matter what', () => {
            expect(sessionRecording.status).toBe('lazy_loading')
        })

        it('does not load script if disable_session_recording passed', () => {
            posthog.config.disable_session_recording = true

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(loadScriptMock).not.toHaveBeenCalled()
        })
    })

    describe('after remote cofig', () => {
        beforeEach(() => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
        })

        describe('isRecordingEnabled', () => {
            it('is enabled if both the server and client config says enabled', () => {
                expect(sessionRecording['_isRecordingEnabled']).toBeTruthy()
            })

            it('is disabled if the server is disabled', () => {
                posthog.persistence?.register({
                    [SESSION_RECORDING_REMOTE_CONFIG]: {
                        enabled: false,
                    },
                })
                expect(sessionRecording['_isRecordingEnabled']).toBe(false)
            })

            it('is disabled if the client config is disabled', () => {
                posthog.config.disable_session_recording = true
                expect(sessionRecording['_isRecordingEnabled']).toBe(false)
            })
        })

        describe('remote config cache invalidation', () => {
            const FIVE_MINUTES_IN_MS = 5 * 60 * 1000

            it.each([
                [
                    'ignores config with stale cache_timestamp (> 5 minutes old)',
                    { enabled: true, endpoint: '/s/', cache_timestamp: Date.now() - FIVE_MINUTES_IN_MS - 1000 },
                    false,
                ],
                [
                    'uses config with fresh cache_timestamp (< 5 minutes old)',
                    { enabled: true, endpoint: '/s/', cache_timestamp: Date.now() - FIVE_MINUTES_IN_MS + 60000 },
                    true,
                ],
                [
                    'uses config with very recent cache_timestamp',
                    { enabled: true, endpoint: '/s/', cache_timestamp: Date.now() - 1000 },
                    true,
                ],
            ])('%s', (_name, persistedConfig, shouldUseConfig) => {
                // stop recording so TTL check is active
                sessionRecording.stopRecording()

                posthog.persistence?.register({
                    [SESSION_RECORDING_REMOTE_CONFIG]: persistedConfig,
                })

                const result = sessionRecording['_lazyLoadedSessionRecording']['_remoteConfig']

                if (shouldUseConfig) {
                    expect(result?.enabled).toBe(true)
                } else {
                    expect(result).toBeUndefined()
                    expect(posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG)).toBeUndefined()
                }
            })

            it('treats legacy config without cache_timestamp as fresh', () => {
                sessionRecording.stopRecording()

                posthog.persistence?.register({
                    [SESSION_RECORDING_REMOTE_CONFIG]: { enabled: true, endpoint: '/s/' },
                })

                const result = sessionRecording['_lazyLoadedSessionRecording']['_remoteConfig']
                expect(result?.enabled).toBe(true)
                expect(result?.endpoint).toBe('/s/')
            })

            it('trusts stale config once recording has started (long-lived SPA)', () => {
                expect(sessionRecording['_lazyLoadedSessionRecording'].isStarted).toBe(true)

                // simulate time passing and config becoming stale
                posthog.persistence?.register({
                    [SESSION_RECORDING_REMOTE_CONFIG]: {
                        enabled: true,
                        endpoint: '/s/',
                        cache_timestamp: Date.now() - FIVE_MINUTES_IN_MS - 1000,
                    },
                })

                // should still return config because recording has started
                const config = sessionRecording['_lazyLoadedSessionRecording']['_remoteConfig']
                expect(config?.enabled).toBe(true)
            })
        })

        describe('isConsoleLogCaptureEnabled', () => {
            it.each([
                ['enabled when both enabled', true, true, true],
                ['uses client side setting when set to false', true, false, false],
                ['uses client side setting when set to true', false, true, true],
                ['disabled when both disabled', false, false, false],
                ['uses client side setting (disabled) if server side setting is not set', undefined, false, false],
                ['uses client side setting (enabled) if server side setting is not set', undefined, true, true],
                ['is disabled when nothing is set', undefined, undefined, false],
                ['uses server side setting (disabled) if client side setting is not set', undefined, false, false],
                ['uses server side setting (enabled) if client side setting is not set', undefined, true, true],
            ])(
                '%s',
                (
                    _name: string,
                    serverSide: boolean | undefined,
                    clientSide: boolean | undefined,
                    expected: boolean
                ) => {
                    posthog.persistence?.register({ [CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: serverSide })
                    posthog.config.enable_recording_console_log = clientSide
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_isConsoleLogCaptureEnabled']).toBe(
                        expected
                    )
                }
            )
        })

        describe('is canvas enabled', () => {
            it.each([
                ['enabled when both enabled', true, true, true],
                ['uses client side setting when set to false', true, false, false],
                ['uses client side setting when set to true', false, true, true],
                ['disabled when both disabled', false, false, false],
                ['uses client side setting (disabled) if server side setting is not set', undefined, false, false],
                ['uses client side setting (enabled) if server side setting is not set', undefined, true, true],
                ['is disabled when nothing is set', undefined, undefined, false],
                ['uses server side setting (disabled) if client side setting is not set', undefined, false, false],
                ['uses server side setting (enabled) if client side setting is not set', undefined, true, true],
            ])(
                '%s',
                (
                    _name: string,
                    serverSide: boolean | undefined,
                    clientSide: boolean | undefined,
                    expected: boolean
                ) => {
                    posthog.persistence?.register({
                        [SESSION_RECORDING_REMOTE_CONFIG]: {
                            cache_timestamp: Date.now(),
                            canvasRecording: { enabled: serverSide, fps: 4, quality: '0.1' },
                        },
                    })
                    posthog.config.session_recording.captureCanvas = { recordCanvas: clientSide }
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_canvasRecording']).toMatchObject({
                        enabled: expected,
                        fps: 4,
                        quality: 0.1,
                    })
                }
            )

            it.each([
                ['max fps and quality', 12, '1.0', 12, 1],
                ['min fps and quality', 0, '0.0', 0, 0],
                ['mid fps and quality', 6, '0.5', 6, 0.5],
                ['null fps and quality', null, null, 4, 0.4],
                ['undefined fps and quality', undefined, undefined, 4, 0.4],
                ['string fps and quality', '12', '1.0', 4, 1],
                ['over max fps and quality', 15, '1.5', 12, 1],
            ])(
                '%s',
                (
                    _name: string,
                    fps: number | string | null | undefined,
                    quality: string | null | undefined,
                    expectedFps: number,
                    expectedQuality: number
                ) => {
                    posthog.persistence?.register({
                        [SESSION_RECORDING_REMOTE_CONFIG]: {
                            cache_timestamp: Date.now(),
                            canvasRecording: { enabled: true, fps, quality },
                        },
                    })

                    expect(sessionRecording['_lazyLoadedSessionRecording']['_canvasRecording']).toMatchObject({
                        enabled: true,
                        fps: expectedFps,
                        quality: expectedQuality,
                    })
                }
            )
        })

        describe('network timing capture config', () => {
            it.each([
                ['enabled when both enabled', true, true, true],
                // returns undefined when nothing is enabled
                ['uses client side setting when set to false - even if remotely enabled', true, false, undefined],
                ['uses client side setting when set to true', false, true, true],
                // returns undefined when nothing is enabled
                ['disabled when both disabled', false, false, undefined],
                // returns undefined when nothing is enabled
                ['uses client side setting (disabled) if server side setting is not set', undefined, false, undefined],
                ['uses client side setting (enabled) if server side setting is not set', undefined, true, true],
                // returns undefined when nothing is enabled
                ['is disabled when nothing is set', undefined, undefined, undefined],
                // returns undefined when nothing is enabled
                [
                    'can be disabled when client object config only is set',
                    undefined,
                    { network_timing: false },
                    undefined,
                ],
                [
                    'can be disabled when client object config only is disabled - even if remotely enabled',
                    true,
                    { network_timing: false },
                    undefined,
                ],
                ['can be enabled when client object config only is set', undefined, { network_timing: true }, true],
                [
                    'can be disabled when client object config makes no decision',
                    undefined,
                    { network_timing: undefined },
                    undefined,
                ],
                ['uses server side setting (disabled) if client side setting is not set', false, undefined, undefined],
                ['uses server side setting (enabled) if client side setting is not set', true, undefined, true],
                // server side returns an object with network_timing
                [
                    'uses server side object config with network_timing enabled',
                    { network_timing: true },
                    undefined,
                    true,
                ],
                [
                    'uses server side object config with network_timing disabled',
                    { network_timing: false },
                    undefined,
                    undefined,
                ],
                [
                    'does not enable network timing when server returns object with only web_vitals enabled',
                    { web_vitals: true, network_timing: false },
                    undefined,
                    undefined,
                ],
                [
                    'does not enable network timing when server returns object with only web_vitals and no network_timing',
                    { web_vitals: true },
                    undefined,
                    undefined,
                ],
                [
                    'enables network timing when server returns object with both enabled',
                    { web_vitals: true, network_timing: true },
                    undefined,
                    true,
                ],
                ['client side overrides server side object config', { network_timing: true }, false, undefined],
            ])(
                '%s',
                (
                    _name: string,
                    serverSide: boolean | PerformanceCaptureConfig | undefined,
                    clientSide: boolean | PerformanceCaptureConfig | undefined,
                    expected: boolean | undefined
                ) => {
                    posthog.persistence?.register({
                        [SESSION_RECORDING_REMOTE_CONFIG]: {
                            cache_timestamp: Date.now(),
                            networkPayloadCapture: { capturePerformance: serverSide },
                        },
                    })
                    posthog.config.capture_performance = clientSide
                    expect(
                        sessionRecording['_lazyLoadedSessionRecording']['_networkPayloadCapture']?.recordPerformance
                    ).toBe(expected)
                }
            )
        })

        describe('masking config', () => {
            it.each([
                [
                    'enabled when both enabled',
                    { maskAllInputs: true, maskTextSelector: '*' },
                    { maskAllInputs: true, maskTextSelector: '*' },
                    { maskAllInputs: true, maskTextSelector: '*' },
                ],
                [
                    'disabled when both disabled',
                    { maskAllInputs: false },
                    { maskAllInputs: false },
                    { maskAllInputs: false },
                ],
                ['is undefined when nothing is set', undefined, undefined, undefined],
                [
                    'uses client config when set if server config is not set',
                    undefined,
                    { maskAllInputs: true, maskTextSelector: '#client' },
                    { maskAllInputs: true, maskTextSelector: '#client' },
                ],
                [
                    'uses server config when set if client config is not set',
                    { maskAllInputs: false, maskTextSelector: '#server' },
                    undefined,
                    { maskAllInputs: false, maskTextSelector: '#server' },
                ],
                [
                    'overrides server config with client config if both are set',
                    { maskAllInputs: false, maskTextSelector: '#server' },
                    { maskAllInputs: true, maskTextSelector: '#client' },
                    { maskAllInputs: true, maskTextSelector: '#client' },
                ],
                [
                    'partially overrides server config with client config if both are set',
                    { maskAllInputs: true, maskTextSelector: '*' },
                    { maskAllInputs: false },
                    { maskAllInputs: false, maskTextSelector: '*' },
                ],
                [
                    'mask inputs default is correct if client sets text selector',
                    undefined,
                    { maskTextSelector: '*' },
                    { maskAllInputs: true, maskTextSelector: '*' },
                ],
                [
                    'can set blockSelector to img',
                    undefined,
                    { blockSelector: 'img' },
                    { maskAllInputs: true, maskTextSelector: undefined, blockSelector: 'img' },
                ],
                [
                    'can set blockSelector to some other selector',
                    undefined,
                    { blockSelector: 'div' },
                    { maskAllInputs: true, maskTextSelector: undefined, blockSelector: 'div' },
                ],
            ])(
                '%s',
                (
                    _name: string,
                    serverConfig:
                        | { maskAllInputs?: boolean; maskTextSelector?: string; blockSelector?: string }
                        | undefined,
                    clientConfig:
                        | { maskAllInputs?: boolean; maskTextSelector?: string; blockSelector?: string }
                        | undefined,
                    expected: { maskAllInputs: boolean; maskTextSelector?: string; blockSelector?: string } | undefined
                ) => {
                    posthog.persistence?.register({
                        [SESSION_RECORDING_REMOTE_CONFIG]: {
                            cache_timestamp: Date.now(),
                            masking: serverConfig,
                        },
                    })

                    posthog.config.session_recording.maskAllInputs = clientConfig?.maskAllInputs
                    posthog.config.session_recording.maskTextSelector = clientConfig?.maskTextSelector
                    posthog.config.session_recording.blockSelector = clientConfig?.blockSelector

                    expect(sessionRecording['_lazyLoadedSessionRecording']['_masking']).toEqual(expected)
                }
            )
        })

        describe('idle timeouts', () => {
            let startingTimestamp = -1

            function emitInactiveEvent(activityTimestamp: number, expectIdle: boolean | 'unknown' = false) {
                const snapshotEvent = {
                    event: 123,
                    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                    data: {
                        source: 0,
                        adds: [],
                        attributes: [],
                        removes: [],
                        texts: [],
                    },
                    timestamp: activityTimestamp,
                }
                _emit(snapshotEvent)
                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual(expectIdle)
                return snapshotEvent
            }

            function emitActiveEvent(activityTimestamp: number, expectedMatchingActivityTimestamp: boolean = true) {
                const snapshotEvent = {
                    event: 123,
                    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                    data: {
                        source: 1,
                    },
                    timestamp: activityTimestamp,
                }
                _emit(snapshotEvent)
                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual(false)
                if (expectedMatchingActivityTimestamp) {
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_lastActivityTimestamp']).toEqual(
                        activityTimestamp
                    )
                }
                return snapshotEvent
            }

            beforeEach(() => {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
                expect(sessionRecording.status).toEqual('active')

                startingTimestamp = sessionRecording['_lazyLoadedSessionRecording']['_lastActivityTimestamp']
                expect(startingTimestamp).toBeGreaterThan(0)

                expect(assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot).toHaveBeenCalledTimes(0)

                // the buffer starts out empty
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [],
                    sessionId: sessionId,
                    size: 0,
                    windowId: 'windowId',
                })

                // options will have been emitted
                expect(_addCustomEvent).toHaveBeenCalled()
                _addCustomEvent.mockClear()
            })

            afterEach(() => {
                jest.useRealTimers()
            })

            it('starts neither idle nor active', () => {
                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual('unknown')
            })

            it('does not emit events until after first active event', () => {
                const a = emitInactiveEvent(startingTimestamp + 100, 'unknown')
                const b = emitInactiveEvent(startingTimestamp + 110, 'unknown')
                const c = emitInactiveEvent(startingTimestamp + 120, 'unknown')

                _emit(createFullSnapshot({}), 'unknown')
                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual('unknown')
                expect(posthog.capture).not.toHaveBeenCalled()

                const d = emitActiveEvent(startingTimestamp + 200)
                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual(false)
                // but all events are buffered
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [a, b, c, createFullSnapshot({}), d],
                    sessionId: sessionId,
                    size: 442,
                    windowId: expect.any(String),
                })
            })

            it('does not emit plugin events when idle', () => {
                const emptyBuffer = {
                    ...EMPTY_BUFFER,
                    sessionId: sessionId,
                    windowId: 'windowId',
                }

                // force idle state
                sessionRecording['_lazyLoadedSessionRecording']['_isIdle'] = true
                // buffer is empty
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual(emptyBuffer)

                sessionRecording.onRRwebEmit(createPluginSnapshot({}) as eventWithTime)

                // a plugin event doesn't count as returning from idle
                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual(true)
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    ...EMPTY_BUFFER,
                    sessionId: sessionId,
                    windowId: 'windowId',
                })
            })

            it('active incremental events return from idle', () => {
                const emptyBuffer = {
                    ...EMPTY_BUFFER,
                    sessionId: sessionId,
                    windowId: 'windowId',
                }

                // force idle state
                sessionRecording['_lazyLoadedSessionRecording']['_isIdle'] = true
                // buffer is empty
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual(emptyBuffer)

                sessionRecording.onRRwebEmit(createIncrementalSnapshot({}) as eventWithTime)

                // an incremental event counts as returning from idle
                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual(false)
                // buffer contains event allowed when idle
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [createIncrementalSnapshot({})],
                    sessionId: sessionId,
                    size: 30,
                    windowId: 'windowId',
                })
            })

            it('does not emit buffered custom events while idle even when over buffer max size', () => {
                // force idle state
                sessionRecording['_lazyLoadedSessionRecording']['_isIdle'] = true
                // buffer is empty
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    ...EMPTY_BUFFER,
                    sessionId: sessionId,
                    windowId: 'windowId',
                })

                // ensure buffer isn't empty
                sessionRecording.onRRwebEmit(createCustomSnapshot({}) as eventWithTime)

                // fake having a large buffer
                // in reality we would need a very long idle period emitting custom events to reach 1MB of buffer data
                // particularly since we flush the buffer on entering idle
                sessionRecording['_lazyLoadedSessionRecording']['_buffer'].size = RECORDING_MAX_EVENT_SIZE - 1
                sessionRecording.onRRwebEmit(createCustomSnapshot({}) as eventWithTime)

                // we're still idle
                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toBe(true)
                // return from idle

                // we did not capture
                expect(posthog.capture).not.toHaveBeenCalled()
            })

            it('drops full snapshots when idle - so we must make sure not to take them while idle!', () => {
                // force idle state
                sessionRecording['_lazyLoadedSessionRecording']['_isIdle'] = true
                // buffer is empty
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    ...EMPTY_BUFFER,
                    sessionId: sessionId,
                    windowId: 'windowId',
                })

                sessionRecording.onRRwebEmit(createFullSnapshot({}) as eventWithTime)

                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [],
                    sessionId: sessionId,
                    size: 0,
                    windowId: 'windowId',
                })
            })

            it('does not emit meta snapshot events when idle - so we must make sure not to take them while idle!', () => {
                // force idle state
                sessionRecording['_lazyLoadedSessionRecording']['_isIdle'] = true
                // buffer is empty
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    ...EMPTY_BUFFER,
                    sessionId: sessionId,
                    windowId: 'windowId',
                })

                sessionRecording.onRRwebEmit(createMetaSnapshot({}) as eventWithTime)

                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [],
                    sessionId: sessionId,
                    size: 0,
                    windowId: 'windowId',
                })
            })

            it('does not emit style snapshot events when idle - so we must make sure not to take them while idle!', () => {
                // force idle state
                sessionRecording['_lazyLoadedSessionRecording']['_isIdle'] = true
                // buffer is empty
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    ...EMPTY_BUFFER,
                    sessionId: sessionId,
                    windowId: 'windowId',
                })

                sessionRecording.onRRwebEmit(createStyleSnapshot({}) as eventWithTime)

                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [],
                    sessionId: sessionId,
                    size: 0,
                    windowId: 'windowId',
                })
            })

            it.each(['$session_ending', '$session_starting'])('allows %s events when idle', (eventTag: string) => {
                // force idle state
                sessionRecording['_lazyLoadedSessionRecording']['_isIdle'] = true
                sessionRecording['_lazyLoadedSessionRecording']['_lastActivityTimestamp'] = startingTimestamp + 100
                // buffer is empty
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    ...EMPTY_BUFFER,
                    sessionId: sessionId,
                    windowId: 'windowId',
                })

                const event = createCustomSnapshot(
                    { timestamp: startingTimestamp + 5000 },
                    { lastActivityTimestamp: startingTimestamp + 100 },
                    eventTag
                )
                sessionRecording.onRRwebEmit(event as eventWithTime)

                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(1)
                const bufferedEvent = sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data[0]
                expect(bufferedEvent.data.tag).toBe(eventTag)
            })

            it.each(['$session_ending', '$session_starting'])(
                'corrects timestamp for %s events when idle',
                (eventTag: string) => {
                    const lastActivityTime = startingTimestamp + 100
                    const eventRecordedTime = startingTimestamp + 5000

                    // force idle state
                    sessionRecording['_lazyLoadedSessionRecording']['_isIdle'] = true
                    sessionRecording['_lazyLoadedSessionRecording']['_lastActivityTimestamp'] = lastActivityTime

                    const event = createCustomSnapshot(
                        { timestamp: eventRecordedTime },
                        { lastActivityTimestamp: lastActivityTime },
                        eventTag
                    )
                    sessionRecording.onRRwebEmit(event as eventWithTime)

                    const bufferedEvent = sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data[0]
                    // timestamp should be corrected to lastActivityTimestamp, not the time rrweb recorded it
                    expect(bufferedEvent.timestamp).toBe(lastActivityTime)
                }
            )

            it("enters idle state within one session if the activity is non-user generated and there's no activity for (RECORDING_IDLE_ACTIVITY_TIMEOUT_MS) 5 minutes", () => {
                const firstActivityTimestamp = startingTimestamp + 100
                const secondActivityTimestamp = startingTimestamp + 200
                const thirdActivityTimestamp = startingTimestamp + RECORDING_IDLE_THRESHOLD_MS + 1000
                const fourthActivityTimestamp = startingTimestamp + RECORDING_IDLE_THRESHOLD_MS + 2000

                const firstSnapshotEvent = emitActiveEvent(firstActivityTimestamp)
                // event was active so activity timestamp is updated
                expect(sessionRecording['_lazyLoadedSessionRecording']['_lastActivityTimestamp']).toEqual(
                    firstActivityTimestamp
                )

                // after the first emit the buffer has been initialised but not flushed
                const firstSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [firstSnapshotEvent],
                    sessionId: firstSessionId,
                    size: 68,
                    windowId: expect.any(String),
                })

                // the session id generator returns a fixed value, but we want it to rotate in part of this test
                sessionIdGeneratorMock.mockClear()
                const rotatedSessionId = 'rotated-session-id'
                sessionIdGeneratorMock.mockImplementation(() => rotatedSessionId)

                const secondSnapshot = emitInactiveEvent(secondActivityTimestamp, false)
                // event was not active so activity timestamp is not updated
                expect(sessionRecording['_lazyLoadedSessionRecording']['_lastActivityTimestamp']).toEqual(
                    firstActivityTimestamp
                )

                // the second snapshot remains buffered in memory
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [firstSnapshotEvent, secondSnapshot],
                    sessionId: firstSessionId,
                    size: 186,
                    windowId: expect.any(String),
                })

                // this triggers idle state and isn't a user interaction so does not take a full snapshot
                emitInactiveEvent(thirdActivityTimestamp, true)

                // event was not active so activity timestamp is not updated
                expect(sessionRecording['_lazyLoadedSessionRecording']['_lastActivityTimestamp']).toEqual(
                    firstActivityTimestamp
                )

                // the custom event doesn't show here since there's not a real rrweb to emit it
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [
                        // buffer is flushed on switch to idle
                    ],
                    sessionId: firstSessionId,
                    size: 0,
                    windowId: expect.any(String),
                })
                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    {
                        $snapshot_data: [firstSnapshotEvent, secondSnapshot],
                        $session_id: firstSessionId,
                        $snapshot_bytes: 186,
                        $window_id: expect.any(String),
                        $lib: 'web',
                        $lib_version: '0.0.1',
                    },
                    {
                        _batchKey: 'recordings',
                        _noTruncate: true,
                        _url: 'https://test.com/s/',
                        skip_client_rate_limiting: true,
                    }
                )

                // this triggers exit from idle state _and_ is a user interaction, so we take a full snapshot
                const fourthSnapshot = emitActiveEvent(fourthActivityTimestamp)

                expect(sessionRecording['_lazyLoadedSessionRecording']['_lastActivityTimestamp']).toEqual(
                    fourthActivityTimestamp
                )

                // the fourth snapshot should not trigger a flush because the session id has not changed...
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    // as we return from idle we will capture a full snapshot _before_ the fourth snapshot
                    data: [fourthSnapshot],
                    sessionId: firstSessionId,
                    size: 68,
                    windowId: expect.any(String),
                })

                // because not enough time passed while idle we still have the same session id at the end of this sequence
                const endingSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']
                expect(endingSessionId).toEqual(firstSessionId)
            })

            it('rotates session if idle for (MAX_SESSION_IDLE_TIMEOUT) 30 minutes', () => {
                const firstActivityTimestamp = startingTimestamp + 100
                const secondActivityTimestamp = startingTimestamp + 200
                const thirdActivityTimestamp = sessionManager['_sessionTimeoutMs'] + startingTimestamp + 1
                const fourthActivityTimestamp = sessionManager['_sessionTimeoutMs'] + startingTimestamp + 1000

                const firstSnapshotEvent = emitActiveEvent(firstActivityTimestamp)
                // event was active so activity timestamp is updated
                expect(sessionRecording['_lazyLoadedSessionRecording']['_lastActivityTimestamp']).toEqual(
                    firstActivityTimestamp
                )

                // after the first emit the buffer has been initialised but not flushed
                const firstSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [firstSnapshotEvent],
                    sessionId: firstSessionId,
                    size: 68,
                    windowId: expect.any(String),
                })

                // the session id generator returns a fixed value, but we want it to rotate in part of this test
                sessionIdGeneratorMock.mockClear()
                const rotatedSessionId = 'rotated-session-id'
                sessionIdGeneratorMock.mockImplementation(() => rotatedSessionId)

                const secondSnapshot = emitInactiveEvent(secondActivityTimestamp, false)
                // event was not active so activity timestamp is not updated
                expect(sessionRecording['_lazyLoadedSessionRecording']['_lastActivityTimestamp']).toEqual(
                    firstActivityTimestamp
                )

                // the second snapshot remains buffered in memory
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [firstSnapshotEvent, secondSnapshot],
                    sessionId: firstSessionId,
                    size: 186,
                    windowId: expect.any(String),
                })

                // this triggers idle state and isn't a user interaction so does not take a full snapshot

                emitInactiveEvent(thirdActivityTimestamp, true)

                // event was not active so activity timestamp is not updated
                expect(sessionRecording['_lazyLoadedSessionRecording']['_lastActivityTimestamp']).toEqual(
                    firstActivityTimestamp
                )

                // the third snapshot is dropped since it switches the session to idle
                // the custom event doesn't show here since there's not a real rrweb to emit it
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [
                        // the buffer is flushed on switch to idle
                    ],
                    sessionId: firstSessionId,
                    size: 0,
                    windowId: expect.any(String),
                })

                // the buffer is flushed on switch to idle
                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    {
                        $snapshot_data: [firstSnapshotEvent, secondSnapshot],
                        $session_id: firstSessionId,
                        $snapshot_bytes: 186,
                        $window_id: expect.any(String),
                        $lib: 'web',
                        $lib_version: '0.0.1',
                    },
                    {
                        _batchKey: 'recordings',
                        _noTruncate: true,
                        _url: 'https://test.com/s/',
                        skip_client_rate_limiting: true,
                    }
                )

                // this triggers exit from idle state as it is a user interaction
                // this will restart the session so the activity timestamp won't match
                // restarting the session checks the id with "now" so we need to freeze that, or we'll start a second new session
                jest.useFakeTimers().setSystemTime(new Date(fourthActivityTimestamp))
                const fourthSnapshot = emitActiveEvent(fourthActivityTimestamp, false)
                expect(sessionIdGeneratorMock).toHaveBeenCalledTimes(1)
                const endingSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']
                expect(endingSessionId).toEqual(rotatedSessionId)

                // the buffer is flushed, and a full snapshot is taken
                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    {
                        $snapshot_data: [firstSnapshotEvent, secondSnapshot],
                        $session_id: firstSessionId,
                        $snapshot_bytes: 186,
                        $window_id: expect.any(String),
                        $lib: 'web',
                        $lib_version: '0.0.1',
                    },
                    {
                        _batchKey: 'recordings',
                        _noTruncate: true,
                        _url: 'https://test.com/s/',
                        skip_client_rate_limiting: true,
                    }
                )
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                    data: [fourthSnapshot],
                    sessionId: rotatedSessionId,
                    size: 68,
                    windowId: expect.any(String),
                })
            })
        })

        describe('scheduled full snapshots', () => {
            it('starts out unscheduled', () => {
                expect(sessionRecording['_fullSnapshotTimer']).toBe(undefined)
            })

            it('does not schedule a snapshot on start', () => {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                expect(sessionRecording['_fullSnapshotTimer']).toBe(undefined)
            })

            it('schedules a snapshot, when we take a full snapshot', () => {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                const startTimer = sessionRecording['_fullSnapshotTimer']

                _emit(createFullSnapshot())

                expect(sessionRecording['_lazyLoadedSessionRecording']['_fullSnapshotTimer']).not.toBe(undefined)
                expect(sessionRecording['_lazyLoadedSessionRecording']['_fullSnapshotTimer']).not.toBe(startTimer)
            })
        })

        describe('full snapshot timestamp tracking', () => {
            beforeEach(() => {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
            })

            it.each([
                [1, [1000]],
                [6, [1000, 2000, 3000, 4000, 5000, 6000]],
                [8, [3000, 4000, 5000, 6000, 7000, 8000]],
            ])('tracks last 6 full snapshot timestamps when %s snapshots emitted', (count, expectedTimestamps) => {
                for (let i = 1; i <= count; i++) {
                    _emit(createFullSnapshot({ timestamp: i * 1000 }))
                }

                const snapshots = sessionRecording['_lazyLoadedSessionRecording']['_fullSnapshotTimestamps']
                expect(snapshots).toEqual(expectedTimestamps.map((ts: number) => [sessionId, ts]))
            })

            it('exposes full snapshot timestamps in sdkDebugProperties', () => {
                _emit(createFullSnapshot({ timestamp: 1000 }))
                _emit(createFullSnapshot({ timestamp: 2000 }))

                expect(sessionRecording.sdkDebugProperties.$sdk_debug_replay_full_snapshots).toEqual([
                    [sessionId, 1000],
                    [sessionId, 2000],
                ])
            })

            it('records the session id at the time of the snapshot', () => {
                const firstSessionId = sessionId

                _emit(createFullSnapshot({ timestamp: 1000 }))
                _emit(createFullSnapshot({ timestamp: 2000 }))

                sessionManager.resetSessionId()
                sessionId = 'rotated-session-id'
                _emit(createIncrementalSnapshot({ data: { source: 1 } }))

                _emit(createFullSnapshot({ timestamp: 3000 }))

                expect(sessionRecording['_lazyLoadedSessionRecording']['_fullSnapshotTimestamps']).toEqual([
                    [firstSessionId, 1000],
                    [firstSessionId, 2000],
                    ['rotated-session-id', 3000],
                ])
            })
        })

        describe('when pageview capture is disabled', () => {
            beforeEach(() => {
                jest.spyOn(sessionRecording, 'tryAddCustomEvent')
                posthog.config.capture_pageview = false
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                jest.spyOn(sessionRecording['_lazyLoadedSessionRecording'], '_tryAddCustomEvent')
            })

            it('does not capture pageview on meta event', () => {
                _emit(createIncrementalSnapshot({ type: META_EVENT_TYPE }))

                expect(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']).not.toHaveBeenCalled()
            })

            it('captures pageview as expected on non-meta event', () => {
                fakeNavigateTo('https://test.com')

                _emit(createIncrementalSnapshot({ type: 3 }))

                expect(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']).toHaveBeenCalledWith(
                    '$url_changed',
                    {
                        href: 'https://test.com/',
                    }
                )
                ;(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent'] as any).mockClear()

                _emit(createIncrementalSnapshot({ type: 3 }))
                // the window href has not changed, so we don't capture another pageview
                expect(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']).not.toHaveBeenCalled()

                fakeNavigateTo('https://test.com/other')
                _emit(createIncrementalSnapshot({ type: 3 }))

                // the window href has changed, so we capture another pageview
                expect(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']).toHaveBeenCalledWith(
                    '$url_changed',
                    {
                        href: 'https://test.com/other',
                    }
                )
            })
        })

        describe('when pageview capture is enabled', () => {
            beforeEach(() => {
                posthog.config.capture_pageview = true
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                jest.spyOn(sessionRecording['_lazyLoadedSessionRecording'], '_tryAddCustomEvent')
            })

            it('does not capture pageview on rrweb events', () => {
                _emit(createIncrementalSnapshot({ type: 3 }))

                expect(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']).not.toHaveBeenCalled()
            })
        })

        describe('when compression is active', () => {
            const captureOptions = {
                _batchKey: 'recordings',
                _noTruncate: true,
                _url: 'https://test.com/s/',
                skip_client_rate_limiting: true,
            }

            beforeEach(() => {
                posthog.config.session_recording.compress_events = true
                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                // need to have active event to start recording
                _emit(createIncrementalSnapshot({ type: 3 }))
                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()
            })

            it('compresses full snapshot data', () => {
                _emit(
                    createFullSnapshot({
                        data: {
                            content: Array(30).fill(uuidv7()).join(''),
                        },
                    })
                )
                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    {
                        $snapshot_data: [
                            {
                                data: expect.any(String),
                                cv: '2024-10',
                                type: 2,
                            },
                        ],
                        $session_id: sessionId,
                        $snapshot_bytes: expect.any(Number),
                        $window_id: 'windowId',
                        $lib: 'web',
                        $lib_version: '0.0.1',
                    },
                    captureOptions
                )
            })

            it('compresses incremental snapshot mutation data', () => {
                _emit(createIncrementalMutationEvent({ texts: [Array(30).fill(uuidv7()).join('')] }))
                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    {
                        $snapshot_data: [
                            {
                                cv: '2024-10',
                                data: {
                                    adds: expect.any(String),
                                    texts: expect.any(String),
                                    removes: expect.any(String),
                                    attributes: expect.any(String),
                                    isAttachIframe: true,
                                    source: 0,
                                },
                                type: 3,
                            },
                        ],
                        $session_id: sessionId,
                        $snapshot_bytes: expect.any(Number),
                        $window_id: 'windowId',
                        $lib: 'web',
                        $lib_version: '0.0.1',
                    },
                    captureOptions
                )
            })

            it('compresses incremental snapshot style data', () => {
                _emit(createIncrementalStyleSheetEvent({ adds: [Array(30).fill(uuidv7()).join('')] }))
                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    {
                        $snapshot_data: [
                            {
                                data: {
                                    adds: expect.any(String),
                                    id: 1,
                                    removes: expect.any(String),
                                    replace: 'something',
                                    replaceSync: 'something',
                                    source: 8,
                                    styleId: 1,
                                },
                                cv: '2024-10',
                                type: 3,
                            },
                        ],
                        $session_id: sessionId,
                        $snapshot_bytes: expect.any(Number),
                        $window_id: 'windowId',
                        $lib: 'web',
                        $lib_version: '0.0.1',
                    },
                    captureOptions
                )
            })

            it('does not compress small incremental snapshot data', () => {})

            it('does not compress incremental snapshot non full data', () => {
                const mouseEvent = createIncrementalMouseEvent()
                _emit(mouseEvent)
                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    {
                        $snapshot_data: [mouseEvent],
                        $session_id: sessionId,
                        $snapshot_bytes: 86,
                        $window_id: 'windowId',
                        $lib: 'web',
                        $lib_version: '0.0.1',
                    },
                    captureOptions
                )
            })

            it('does not compress custom events', () => {
                _emit(createCustomSnapshot(undefined, { tag: 'wat' }))
                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    {
                        $snapshot_data: [
                            {
                                data: {
                                    payload: { tag: 'wat' },
                                    tag: 'custom',
                                },
                                type: 5,
                            },
                        ],
                        $session_id: sessionId,
                        $snapshot_bytes: 58,
                        $window_id: 'windowId',
                        $lib: 'web',
                        $lib_version: '0.0.1',
                    },
                    captureOptions
                )
            })

            it('does not compress meta events', () => {
                _emit(createMetaSnapshot())
                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    {
                        $snapshot_data: [
                            {
                                type: META_EVENT_TYPE,
                                data: {
                                    href: 'https://has-to-be-present-or-invalid.com',
                                },
                            },
                        ],
                        $session_id: sessionId,
                        $snapshot_bytes: 69,
                        $window_id: 'windowId',
                        $lib: 'web',
                        $lib_version: '0.0.1',
                    },
                    captureOptions
                )
            })
        })
    })

    describe('recording', () => {
        it('calls rrweb.record with the right options', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            // maskAllInputs should change from default
            // someUnregisteredProp should not be present
            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith({
                emit: expect.anything(),
                maskAllInputs: false,
                blockClass: 'ph-no-capture',
                blockSelector: undefined,
                ignoreClass: 'ph-ignore-input',
                maskTextClass: 'ph-mask',
                maskTextSelector: undefined,
                maskInputOptions: { password: true },
                maskInputFn: undefined,
                slimDOMOptions: {},
                collectFonts: false,
                plugins: [],
                inlineStylesheet: true,
                recordCrossOriginIframes: false,
            })
        })

        it('records events emitted before and after starting recording', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            expect(posthog.capture).not.toHaveBeenCalled()

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                data: [
                    {
                        data: {
                            source: 1,
                        },
                        type: 3,
                    },
                ],
                size: 30,
                // session id and window id are not null 🚀
                sessionId: sessionId,
                windowId: 'windowId',
            })

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            // next call to emit won't flush the buffer
            // the events aren't big enough
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            // access private method 🤯so we don't need to wait for the timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toEqual(0)

            expect(posthog.capture).toHaveBeenCalledTimes(1)
            expect(posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                {
                    $snapshot_bytes: 60,
                    $snapshot_data: [
                        { type: 3, data: { source: 1 } },
                        { type: 3, data: { source: 2 } },
                    ],
                    $session_id: sessionId,
                    $window_id: 'windowId',
                    $lib: 'web',
                    $lib_version: '0.0.1',
                },
                {
                    _url: 'https://test.com/s/',
                    _noTruncate: true,
                    _batchKey: 'recordings',
                    skip_client_rate_limiting: true,
                }
            )
        })

        it('buffers emitted events', () => {
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_flushBufferTimer']).not.toBeUndefined()

            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_flushBufferTimer']).toBeUndefined()

            expect(posthog.capture).toHaveBeenCalledTimes(1)
            expect(posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                {
                    $session_id: sessionId,
                    $window_id: 'windowId',
                    $snapshot_bytes: 60,
                    $snapshot_data: [
                        { type: 3, data: { source: 1 } },
                        { type: 3, data: { source: 2 } },
                    ],
                    $lib: 'web',
                    $lib_version: '0.0.1',
                },
                {
                    _url: 'https://test.com/s/',
                    _noTruncate: true,
                    _batchKey: 'recordings',
                    skip_client_rate_limiting: true,
                }
            )
        })

        it('flushes buffer if the size of the buffer hits the limit', () => {
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()
            const bigData = 'a'.repeat(RECORDING_MAX_EVENT_SIZE * 0.8)

            _emit(createIncrementalSnapshot({ data: { source: 1, payload: bigData } }))
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: 2 } }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toMatchObject({ size: 755101 })

            // Another big event means the old data will be flushed
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: bigData } }))
            expect(posthog.capture).toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toEqual(1) // The new event
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toMatchObject({ size: 755017 })
        })

        it('maintains the buffer if the recording is buffering', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['waiting_for_an_event_means_we_are_buffering'],
                    },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()

            const bigData = 'a'.repeat(RECORDING_MAX_EVENT_SIZE * 0.8)

            _emit(createIncrementalSnapshot({ data: { source: 1, payload: bigData } }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toMatchObject({ size: 755017 }) // the size of the big data event
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toEqual(1) // full snapshot and a big event

            _emit(createIncrementalSnapshot({ data: { source: 1, payload: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: 2 } }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toMatchObject({ size: 755101 })

            // Another big event means the old data will be flushed
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: bigData } }))
            // but the recording is still buffering
            expect(sessionRecording.status).toBe('buffering')
            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toEqual(4) // + the new event
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toMatchObject({
                size: 755017 + 755101,
            }) // the size of the big data event
        })

        it('flushes buffer if the session_id changes', () => {
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].sessionId).toEqual(sessionId)

            _emit(createIncrementalSnapshot({ emit: 1 }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].sessionId).not.toEqual(null)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toEqual([
                { data: { source: 1 }, emit: 1, type: 3 },
            ])

            // Not exactly right but easier to test than rotating the session id
            // this simulates as the session id changing _after_ it has initially been set
            // i.e. the data in the buffer should be sent with 'otherSessionId'
            sessionRecording['_lazyLoadedSessionRecording']['_buffer']!.sessionId = 'otherSessionId'
            _emit(createIncrementalSnapshot({ emit: 2 }))

            expect(posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                {
                    $session_id: 'otherSessionId',
                    $window_id: 'windowId',
                    $snapshot_data: [{ data: { source: 1 }, emit: 1, type: 3 }],
                    $snapshot_bytes: 39,
                    $lib: 'web',
                    $lib_version: '0.0.1',
                },
                {
                    _url: 'https://test.com/s/',
                    _noTruncate: true,
                    _batchKey: 'recordings',
                    skip_client_rate_limiting: true,
                }
            )

            // and the rrweb event emitted _after_ the session id change should be sent yet
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                data: [
                    {
                        data: {
                            source: 1,
                        },
                        emit: 2,
                        type: 3,
                    },
                ],
                sessionId: sessionId,
                size: 39,
                windowId: 'windowId',
            })
        })

        it("doesn't load recording script if already loaded", () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            loadScriptMock.mockClear()

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(loadScriptMock).not.toHaveBeenCalled()
        })

        it('loads recording script from right place', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(loadScriptMock).toHaveBeenCalledWith(expect.anything(), 'lazy-recorder', expect.anything())
        })

        it('session recording can be turned on and off', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(sessionRecording.started).toEqual(true)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_stopRrweb']).not.toEqual(undefined)

            sessionRecording.stopRecording()

            expect(sessionRecording['_lazyLoadedSessionRecording']['_stopRrweb']).toEqual(undefined)
            expect(sessionRecording.started).toEqual(false)
        })

        it('can emit when there are circular references', () => {
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            const someObject = { emit: 1 }
            // the same object can be there multiple times
            const circularObject: Record<string, any> = { emit: someObject, again: someObject }
            // but a circular reference will be replaced
            circularObject.circularReference = circularObject
            _emit(createFullSnapshot(circularObject))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                data: [
                    {
                        again: {
                            emit: 1,
                        },
                        circularReference: {
                            again: {
                                emit: 1,
                            },
                            // the circular reference is captured to the buffer,
                            // but it didn't explode when estimating size
                            circularReference: expect.any(Object),
                            emit: {
                                emit: 1,
                            },
                        },
                        data: {},
                        emit: {
                            emit: 1,
                        },
                        type: 2,
                    },
                ],
                sessionId: sessionId,
                size: 149,
                windowId: 'windowId',
            })
        })

        describe('the session id manager', () => {
            const startingDate = new Date()

            const emitAtDateTime = (date: Date, source = 1) =>
                _emit({
                    event: 123,
                    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                    timestamp: date.getTime(),
                    data: {
                        source,
                    },
                })

            describe('onSessionId Callbacks', () => {
                let mockCallback: Mock<SessionIdChangedCallback>
                let unsubscribeCallback: () => void

                beforeEach(() => {
                    sessionManager = new SessionIdManager(
                        createMockPostHog({
                            config,
                            persistence: new PostHogPersistence(config),
                            register: jest.fn(),
                        })
                    )
                    posthog.sessionManager = sessionManager

                    mockCallback = jest.fn()
                    unsubscribeCallback = sessionManager.onSessionId(mockCallback)

                    expect(mockCallback).not.toHaveBeenCalled()

                    sessionRecording.onRemoteConfig(
                        makeFlagsResponse({
                            sessionRecording: {
                                endpoint: '/s/',
                            },
                        })
                    )
                    sessionRecording['_lazyLoadAndStart']()

                    expect(mockCallback).toHaveBeenCalledTimes(1)
                })

                afterEach(() => {
                    jest.useRealTimers()
                })

                it('calls the callback when the session id changes', () => {
                    const startingSessionId = sessionManager['_getSessionId']()[1]

                    emitAtDateTime(startingDate)

                    emitAtDateTime(
                        new Date(
                            startingDate.getFullYear(),
                            startingDate.getMonth(),
                            startingDate.getDate(),
                            startingDate.getHours(),
                            startingDate.getMinutes() + 1
                        )
                    )

                    const inactivityThresholdLater = new Date(
                        startingDate.getFullYear(),
                        startingDate.getMonth(),
                        startingDate.getDate(),
                        startingDate.getHours(),
                        startingDate.getMinutes() + 32
                    )

                    // restarting the session checks the session id using "now" so we need to fix that
                    jest.useFakeTimers().setSystemTime(inactivityThresholdLater)
                    emitAtDateTime(inactivityThresholdLater)

                    expect(sessionManager['_getSessionId']()[1]).not.toEqual(startingSessionId)

                    expect(mockCallback).toHaveBeenCalledTimes(2)
                    // last call received the new session id
                    expect(mockCallback.mock.calls[1][0]).toEqual(sessionManager['_getSessionId']()[1])
                })

                it('does not calls the callback when the session id changes after unsubscribe', () => {
                    unsubscribeCallback()

                    const startingSessionId = sessionManager['_getSessionId']()[1]
                    emitAtDateTime(startingDate)
                    emitAtDateTime(
                        new Date(
                            startingDate.getFullYear(),
                            startingDate.getMonth(),
                            startingDate.getDate(),
                            startingDate.getHours(),
                            startingDate.getMinutes() + 1
                        )
                    )

                    const inactivityThresholdLater = new Date(
                        startingDate.getFullYear(),
                        startingDate.getMonth(),
                        startingDate.getDate(),
                        startingDate.getHours(),
                        startingDate.getMinutes() + 32
                    )
                    emitAtDateTime(inactivityThresholdLater)

                    expect(sessionManager['_getSessionId']()[1]).not.toEqual(startingSessionId)

                    expect(mockCallback).toHaveBeenCalledTimes(1)
                    // the only call received the original session id
                    expect(mockCallback.mock.calls[0][0]).toEqual(startingSessionId)
                })
            })

            describe('with a real session id manager', () => {
                beforeEach(() => {
                    sessionManager = new SessionIdManager(
                        createMockPostHog({
                            config,
                            persistence: new PostHogPersistence(config),
                            register: jest.fn(),
                        })
                    )
                    posthog.sessionManager = sessionManager

                    sessionRecording.onRemoteConfig(
                        makeFlagsResponse({
                            sessionRecording: {
                                endpoint: '/s/',
                            },
                        })
                    )
                    sessionRecording['_lazyLoadAndStart']()
                })

                it('does not change session id for a second _emit', () => {
                    const startingSessionId = sessionManager['_getSessionId']()[1]

                    emitAtDateTime(startingDate)
                    emitAtDateTime(
                        new Date(
                            startingDate.getFullYear(),
                            startingDate.getMonth(),
                            startingDate.getDate(),
                            startingDate.getHours(),
                            startingDate.getMinutes() + 1
                        )
                    )

                    expect(sessionManager['_getSessionId']()[1]).toEqual(startingSessionId)
                })

                it('restarts recording if the session is rotated because session has been inactive for 30 minutes', () => {
                    const startingSessionId = sessionManager['_getSessionId']()[1]

                    sessionRecording['_lazyLoadedSessionRecording'].stop = jest.fn()
                    sessionRecording['_lazyLoadedSessionRecording'].start = jest.fn()

                    emitAtDateTime(startingDate)
                    emitAtDateTime(
                        new Date(
                            startingDate.getFullYear(),
                            startingDate.getMonth(),
                            startingDate.getDate(),
                            startingDate.getHours(),
                            startingDate.getMinutes() + 1
                        )
                    )

                    const inactivityThresholdLater = new Date(
                        startingDate.getFullYear(),
                        startingDate.getMonth(),
                        startingDate.getDate(),
                        startingDate.getHours(),
                        startingDate.getMinutes() + 32
                    )
                    emitAtDateTime(inactivityThresholdLater)

                    expect(sessionManager['_getSessionId']()[1]).not.toEqual(startingSessionId)
                    expect(sessionRecording['_lazyLoadedSessionRecording'].stop).toHaveBeenCalled()
                    expect(sessionRecording['_lazyLoadedSessionRecording'].start).toHaveBeenCalled()
                })

                it('restarts recording if the session is rotated because max time has passed', () => {
                    const startingSessionId = sessionManager['_getSessionId']()[1]

                    sessionRecording['_lazyLoadedSessionRecording'].stop = jest.fn()
                    sessionRecording['_lazyLoadedSessionRecording'].start = jest.fn()

                    emitAtDateTime(startingDate)
                    emitAtDateTime(
                        new Date(
                            startingDate.getFullYear(),
                            startingDate.getMonth(),
                            startingDate.getDate(),
                            startingDate.getHours(),
                            startingDate.getMinutes() + 1
                        )
                    )

                    const moreThanADayLater = new Date(
                        startingDate.getFullYear(),
                        startingDate.getMonth(),
                        startingDate.getDate() + 1,
                        startingDate.getHours() + 1
                    )
                    emitAtDateTime(moreThanADayLater)

                    expect(sessionManager['_getSessionId']()[1]).not.toEqual(startingSessionId)

                    expect(sessionRecording['_lazyLoadedSessionRecording'].stop).toHaveBeenCalled()
                    expect(sessionRecording['_lazyLoadedSessionRecording'].start).toHaveBeenCalled()
                })
            })
        })
    })

    describe('URL blocking', () => {
        it('does not flush buffer and includes pause event when hitting blocked URL', async () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        urlBlocklist: [
                            {
                                matching: 'regex',
                                url: '/blocked',
                            },
                        ],
                    },
                })
            )

            // Emit some events before hitting blocked URL
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            // Simulate URL change to blocked URL
            fakeNavigateTo('https://test.com/blocked')

            expect(posthog.capture).not.toHaveBeenCalled()

            // Verify subsequent events are not captured while on blocked URL
            _emit(createIncrementalSnapshot({ data: { source: 3 } }))
            _emit(createIncrementalSnapshot({ data: { source: 4 } }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toEqual([
                {
                    data: {
                        source: 1,
                    },
                    type: 3,
                },
                {
                    data: {
                        source: 2,
                    },
                    type: 3,
                },
            ])

            // Simulate URL change to allowed URL
            fakeNavigateTo('https://test.com/allowed')

            // Verify recording resumes with resume event
            _emit(createIncrementalSnapshot({ data: { source: 5 } }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toStrictEqual([
                {
                    data: {
                        source: 1,
                    },
                    type: 3,
                },
                {
                    data: {
                        source: 2,
                    },
                    type: 3,
                },
                // restarts with a snapshot
                expect.objectContaining({
                    type: 2,
                }),
                expect.objectContaining({
                    type: 3,
                    data: { source: 5 },
                }),
            ])
        })

        it('only pauses once when sampling determines session should not record', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        sampleRate: '0.00',
                        urlBlocklist: [
                            {
                                matching: 'regex',
                                url: '/blocked',
                            },
                        ],
                    },
                })
            )
            jest.spyOn(sessionRecording['_lazyLoadedSessionRecording'], '_tryAddCustomEvent')
            expect(sessionRecording.status).toBe('disabled')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_urlTriggerMatching']['urlBlocked']).toBe(false)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(0)

            fakeNavigateTo('https://test.com/blocked')
            // check is trigger by rrweb emit, not the navigation per se, so...
            _emit(createFullSnapshot({ data: { source: 1 } }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording.status).toBe('paused')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_urlTriggerMatching']['urlBlocked']).toBe(true)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(0)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']).toHaveBeenCalledWith(
                'recording paused',
                {
                    reason: 'url blocker',
                }
            )
            ;(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent'] as any).mockClear()

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            // regression: to check we've not accidentally got stuck in a pausing loop
            expect(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']).not.toHaveBeenCalledWith(
                'recording paused',
                {
                    reason: 'url blocker',
                }
            )
        })
    })

    describe('Event triggering', () => {
        it('flushes buffer and starts when sees event', async () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')

            // Emit some events before hitting blocked URL
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(2)

            simpleEventEmitter.emit('eventCaptured', { event: 'not-$exception' })

            expect(sessionRecording.status).toBe('buffering')

            simpleEventEmitter.emit('eventCaptured', { event: '$exception' })

            expect(sessionRecording.status).toBe('active')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(0)
        })

        it('starts if sees an event but still waiting for a URL when in OR', async () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                        urlTriggers: [{ url: 'start-on-me', matching: 'regex' }],
                        triggerMatchType: 'any',
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')

            // Emit some events before hitting blocked URL
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(2)

            simpleEventEmitter.emit('eventCaptured', { event: 'not-$exception' })

            expect(sessionRecording.status).toBe('buffering')

            simpleEventEmitter.emit('eventCaptured', { event: '$exception' })

            // even though still waiting for URL to trigger
            expect(sessionRecording.status).toBe('active')
        })

        it('does not start if sees an event but still waiting for a URL when in AND', async () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                        urlTriggers: [{ url: 'start-on-me', matching: 'regex' }],
                        triggerMatchType: 'all',
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')

            // Emit some events before hitting blocked URL
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(2)

            simpleEventEmitter.emit('eventCaptured', { event: 'not-$exception' })

            expect(sessionRecording.status).toBe('buffering')

            simpleEventEmitter.emit('eventCaptured', { event: '$exception' })

            // because still waiting for URL to trigger
            expect(sessionRecording.status).toBe('buffering')
        })

        it('never sends data when sampling is false regardless of event triggers', async () => {
            // this is a regression test for https://posthoghelp.zendesk.com/agent/tickets/24373
            // where the buffered data was sent to capture when the event trigger fired
            // before the sample rate was taken into account
            // and then would immediately stop

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                        sampleRate: '0.00', // i.e. never send recording
                        triggerMatchType: 'all',
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(0)

            // Emit some events before hitting event trigger
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            simpleEventEmitter.emit('eventCaptured', { event: '$exception' })
            expect(sessionRecording.status).toBe('disabled')
            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('sends data when sampling is false and there is an event triggers in OR mode', async () => {
            // this is a regression test for https://posthoghelp.zendesk.com/agent/tickets/24373
            // where the buffered data was sent to capture when the event trigger fired
            // before the sample rate was taken into account
            // and then would immediately stop

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                        sampleRate: '0.00', // i.e. never send recording
                        triggerMatchType: 'any',
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(0)

            // Emit some events before hitting event trigger
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            simpleEventEmitter.emit('eventCaptured', { event: '$exception' })
            expect(sessionRecording.status).toBe('active')
            expect(posthog.capture).toHaveBeenCalled()
        })

        it('clears buffer but keeps most recent meta event when trigger pending and receiving full snapshot', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createMetaSnapshot())
            _emit(createCustomSnapshot({}, { tag: 'test' }))
            _emit(createFullSnapshot())

            // Buffer should only data since (including) the meta event
            const bufferData = sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data
            expect(bufferData).toEqual([
                createMetaSnapshot(),
                createCustomSnapshot({}, { tag: 'test' }),
                createFullSnapshot(),
            ])
        })
    })

    describe('startIfEnabledOrStop', () => {
        beforeEach(() => {
            // need to cast as any to mock private methods
            jest.spyOn(sessionRecording as any, '_lazyLoadAndStart')
            jest.spyOn(sessionRecording, 'stopRecording')
            jest.spyOn(sessionRecording, 'tryAddCustomEvent')
        })

        it('call _lazyLoadAndStart if its enabled', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect((sessionRecording as any)._lazyLoadAndStart).toHaveBeenCalled()
        })

        it('sets the pageview capture hook once', () => {
            expect(sessionRecording['_removePageViewCaptureHook']).toBeUndefined()

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_removePageViewCaptureHook']).not.toBeUndefined()
            expect(posthog.on).toHaveBeenCalledTimes(1)

            // calling a second time doesn't add another capture hook
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(posthog.on).toHaveBeenCalledTimes(1)
        })

        it('removes the pageview capture hook on stop', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_removePageViewCaptureHook']).not.toBeUndefined()

            expect(removePageviewCaptureHookMock).not.toHaveBeenCalled()
            sessionRecording.stopRecording()

            expect(removePageviewCaptureHookMock).toHaveBeenCalledTimes(1)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_removePageViewCaptureHook']).toBeUndefined()
        })

        it('clears the flush buffer timer on stop', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            // Set a flush buffer timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBufferTimer'] = setTimeout(() => {}, 1000)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_flushBufferTimer']).not.toBeUndefined()

            sessionRecording.stopRecording()

            expect(sessionRecording['_lazyLoadedSessionRecording']['_flushBufferTimer']).toBeUndefined()
        })

        it('calls mutation throttler stop on stop', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            // Create a mutation throttler with a spy
            const mutationThrottler = sessionRecording['_lazyLoadedSessionRecording']['_mutationThrottler']
            if (mutationThrottler) {
                const stopSpy = jest.spyOn(mutationThrottler, 'stop')

                sessionRecording.stopRecording()

                expect(stopSpy).toHaveBeenCalled()
            }
        })

        it('clears queued rrweb events on stop', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            // Add some queued events
            sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents'] = [
                { rrwebMethod: () => {}, attempt: 1, enqueuedAt: Date.now() },
                { rrwebMethod: () => {}, attempt: 1, enqueuedAt: Date.now() },
            ]
            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toHaveLength(2)

            sessionRecording.stopRecording()

            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toHaveLength(0)
        })

        it('clears force idle session id listener on stop', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            // Set up a force idle listener
            const mockListener = jest.fn()
            sessionRecording['_lazyLoadedSessionRecording']['_forceIdleSessionIdListener'] = mockListener
            expect(sessionRecording['_lazyLoadedSessionRecording']['_forceIdleSessionIdListener']).toBeDefined()

            sessionRecording.stopRecording()

            expect(mockListener).toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_forceIdleSessionIdListener']).toBeUndefined()
        })

        it('clears persist flags session listener on stop', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            // The listener is created in onRemoteConfig via _persistRemoteConfig
            const mockListener = jest.fn()
            sessionRecording['_persistFlagsOnSessionListener'] = mockListener
            expect(sessionRecording['_persistFlagsOnSessionListener']).toBeDefined()

            sessionRecording.stopRecording()

            expect(mockListener).toHaveBeenCalled()
            expect(sessionRecording['_persistFlagsOnSessionListener']).toBeUndefined()
        })

        it('sets the window event listeners', () => {
            //mock window add event listener to check if it is called
            window.addEventListener = jest.fn().mockImplementation(() => () => {})

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(sessionRecording['_onBeforeUnload']).not.toBeNull()
            // we register 4 event listeners
            expect(window.addEventListener).toHaveBeenCalledTimes(4)

            // window.addEventListener('blah', someFixedListenerInstance) is safe to call multiple times,
            // so we don't need to test if the addEvenListener registrations are called multiple times
        })

        it('call stopRecording if its not enabled', () => {
            posthog.config.disable_session_recording = true
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(sessionRecording.stopRecording).toHaveBeenCalled()
        })
    })

    describe('sampling', () => {
        it('does not emit to capture if the sample rate is 0', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.00' },
                })
            )
            expect(sessionRecording.status).toBe('disabled')

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording.status).toBe('disabled')
        })

        it('does emit to capture if the sample rate is null', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: null },
                })
            )

            expect(sessionRecording.status).toBe('active')
        })

        it('stores excluded session when excluded', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.00' },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_isSampled']).toStrictEqual(false)
        })

        it('does emit to capture if the sample rate is 1', () => {
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            expect(posthog.capture).not.toHaveBeenCalled()

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '1.00' },
                })
            )
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))

            expect(sessionRecording.status).toBe('sampled')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_isSampled']).toStrictEqual(true)

            // don't wait two seconds for the flush timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            expect(posthog.capture).toHaveBeenCalled()
        })

        it('sets emit as expected when sample rate is 0.5', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.50' },
                })
            )
            const emitValues: string[] = []
            let lastSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']

            for (let i = 0; i < 100; i++) {
                // force change the session ID
                sessionManager.resetSessionId()
                sessionId = 'session-id-' + uuidv7()
                _emit(createIncrementalSnapshot({ data: { source: 1 } }))

                expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionId']).not.toBe(lastSessionId)
                lastSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']

                emitValues.push(sessionRecording.status)
            }

            // the random number generator won't always be exactly 0.5, but it should be close
            expect(emitValues.filter((v) => v === 'sampled').length).toBeGreaterThan(30)
            expect(emitValues.filter((v) => v === 'disabled').length).toBeGreaterThan(30)
        })

        it('turning sample rate to null, means sessions are no longer sampled out', () => {
            // set sample rate to 0, i.e. no sessions will run
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({ sessionRecording: { endpoint: '/s/', sampleRate: '0.00' } })
            )
            // then check that a session is sampled (i.e. storage is false not true or null)
            expect(posthog.get_property(SESSION_RECORDING_IS_SAMPLED)).toBe(false)
            expect(sessionRecording.status).toBe('disabled')

            // then turn sample rate to null
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({ sessionRecording: { endpoint: '/s/', sampleRate: null } })
            )

            // then check that a session is no longer sampled out (i.e. storage is cleared not false)
            expect(posthog.get_property(SESSION_RECORDING_IS_SAMPLED)).toBe(undefined)
            expect(sessionRecording.status).toBe('active')
        })

        describe('legacy boolean true in persistence', () => {
            it.each([
                ['0% sample rate', '0.00', 'disabled'],
                ['100% sample rate', '1.00', 'sampled'],
            ] as const)(
                'clears legacy true and makes fresh sampling decision with %s',
                (_name, sampleRate, expectedStatus) => {
                    // simulate legacy SDK having stored boolean true
                    posthog.persistence?.register({
                        [SESSION_RECORDING_IS_SAMPLED]: true,
                    })
                    expect(posthog.get_property(SESSION_RECORDING_IS_SAMPLED)).toBe(true)

                    sessionRecording.onRemoteConfig(
                        makeFlagsResponse({ sessionRecording: { endpoint: '/s/', sampleRate } })
                    )

                    // legacy true should be treated as unknown and a fresh decision made
                    expect(posthog.get_property(SESSION_RECORDING_IS_SAMPLED)).not.toBe(true)
                    expect(sessionRecording.status).toBe(expectedStatus)
                }
            )

            it('legacy true with 0% sample rate does not record even if session has not changed', () => {
                // simulate legacy SDK having stored boolean true
                posthog.persistence?.register({
                    [SESSION_RECORDING_IS_SAMPLED]: true,
                })

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({ sessionRecording: { endpoint: '/s/', sampleRate: '0.00' } })
                )

                // should be disabled despite legacy true, because 0% sample rate
                expect(sessionRecording.status).toBe('disabled')
                expect(posthog.get_property(SESSION_RECORDING_IS_SAMPLED)).toBe(false)

                _emit(createIncrementalSnapshot({ data: { source: 1 } }))
                expect(posthog.capture).not.toHaveBeenCalled()
            })

            it('preserves false from persistence (not legacy, still valid format)', () => {
                posthog.persistence?.register({
                    [SESSION_RECORDING_IS_SAMPLED]: false,
                })

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({ sessionRecording: { endpoint: '/s/', sampleRate: '0.50' } })
                )

                // false is still valid format, should remain disabled
                expect(sessionRecording.status).toBe('disabled')
                expect(posthog.get_property(SESSION_RECORDING_IS_SAMPLED)).toBe(false)
            })
        })
    })

    describe('masking', () => {
        it('passes remote masking options to rrweb', () => {
            posthog.config.session_recording.maskAllInputs = undefined

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        masking: { maskAllInputs: true, maskTextSelector: '*' },
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    maskAllInputs: true,
                    maskTextSelector: '*',
                })
            )
        })

        describe('capturing passwords', () => {
            it.each([
                ['no masking options', {} as SessionRecordingOptions, true],
                ['empty masking options', { maskInputOptions: {} } as SessionRecordingOptions, true],
                ['password not set', { maskInputOptions: { input: true } } as SessionRecordingOptions, true],
                ['password set to true', { maskInputOptions: { password: true } } as SessionRecordingOptions, true],
                ['password set to false', { maskInputOptions: { password: false } } as SessionRecordingOptions, false],
            ])('%s', (_name: string, session_recording: SessionRecordingOptions, expected: boolean) => {
                posthog.config.session_recording = session_recording
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                    expect.objectContaining({
                        maskInputOptions: expect.objectContaining({ password: expected }),
                    })
                )
            })
        })
    })

    describe('console logs', () => {
        it('if not enabled, plugin is not used', () => {
            posthog.config.enable_recording_console_log = false

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(assignableWindow.__PosthogExtensions__.rrwebPlugins.getRecordConsolePlugin).not.toHaveBeenCalled()
        })

        it('if enabled, plugin is used', () => {
            posthog.config.enable_recording_console_log = true

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(assignableWindow.__PosthogExtensions__.rrwebPlugins.getRecordConsolePlugin).toHaveBeenCalled()
        })
    })

    describe('linked flags', () => {
        it('stores the linked flag on flags response', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({ sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' } })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual(
                'the-flag-key'
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.(['the-flag-key'], { 'the-flag-key': true })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('active')

            onFeatureFlagsCallback?.(['different', 'keys'], { different: true, keys: true })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('does not react to flags that are present but false', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({ sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' } })
            )

            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.(['the-flag-key'], { 'the-flag-key': false })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('can handle linked flags with variants', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', linkedFlag: { flag: 'the-flag-key', variant: 'test-a' } },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual({
                flag: 'the-flag-key',
                variant: 'test-a',
            })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.(['the-flag-key'], { 'the-flag-key': 'test-a' })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('active')

            onFeatureFlagsCallback?.(['the-flag-key'], { 'the-flag-key': 'control' })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('can handle linked flags with any variants', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    // when the variant is any we only send the key
                    sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual(
                'the-flag-key'
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.(['the-flag-key'], { 'the-flag-key': 'literally-anything' })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('active')

            onFeatureFlagsCallback?.(['not-the-flag-key'], { 'not-the-flag-key': 'literally-anything' })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('can be overriden', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({ sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' } })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual(
                'the-flag-key'
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            sessionRecording.overrideLinkedFlag()

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('active')
        })

        /**
         * this is partly a regression test, with a running rrweb,
         * if you don't pause while buffering
         * the browser can be trapped in an infinite loop of pausing
         * while trying to report it is paused 🙈
         */
        it('can be paused while waiting for flag', () => {
            fakeNavigateTo('https://test.com/blocked')

            expect(sessionRecording.status).toEqual('lazy_loading')

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        linkedFlag: 'the-flag-key',
                        urlBlocklist: [
                            {
                                matching: 'regex',
                                url: '/blocked',
                            },
                        ],
                    },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual(
                'the-flag-key'
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
            expect(sessionRecording['paused']).toBeUndefined()

            const snapshotEvent = {
                event: 123,
                type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                data: {
                    source: 1,
                },
                timestamp: new Date().getTime(),
            }
            _emit(snapshotEvent)

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual(
                'the-flag-key'
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('paused')

            sessionRecording.overrideLinkedFlag()

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('paused')

            fakeNavigateTo('https://test.com/allowed')

            expect(sessionRecording.status).toEqual('paused')

            _emit(snapshotEvent)
            expect(sessionRecording.status).toEqual('active')
        })
    })

    describe('when rrweb is not available', () => {
        beforeEach(() => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toEqual([])

            // fake rrweb being unavailable
            assignableWindow.__PosthogExtensions__.rrweb.record = null
        })

        it('queues events', () => {
            sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']('test', { test: 'test' })

            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toHaveLength(1)
        })

        it('limits the queue of events', () => {
            sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']('test', { test: 'test' })

            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toHaveLength(1)

            for (let i = 0; i < 100; i++) {
                sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']('test', { test: 'test' })
            }

            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toHaveLength(10)
        })

        it('processes the queue when rrweb is available again', () => {
            addRRwebToWindow()

            sessionRecording['_lazyLoadedSessionRecording'].onRRwebEmit(
                createIncrementalSnapshot({ data: { source: 1 } }) as any
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toHaveLength(0)
        })
    })

    describe('buffering minimum duration', () => {
        it('can report no duration when no data', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(null)
        })

        it('can report zero duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(0)
        })

        it('can report a duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 100 }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(100)
        })

        it('starts with an undefined minimum duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_minimumDuration']).toBe(null)
        })

        it('can set minimum duration from flags response', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_minimumDuration']).toBe(1500)
        })

        it('does not flush if below the minimum duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )
            expect(sessionRecording.status).toBe('active')
            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 100 }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(100)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_minimumDuration']).toBe(1500)

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(1) // the emitted incremental event
            // call the private method to avoid waiting for the timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('does flush if session duration is negative', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )

            expect(sessionRecording.status).toBe('active')
            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)

            // if we have some data in the buffer and the buffer has a session id but then the session id changes
            // then the session duration will be negative, and we will never flush the buffer
            // this setup isn't quite that but does simulate the behaviour closely enough
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp - 1000 }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(-1000)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_minimumDuration']).toBe(1500)

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(1) // the emitted incremental event
            // call the private method to avoid waiting for the timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(posthog.capture).toHaveBeenCalled()
        })

        it('does not stay buffering after the minimum duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )

            expect(sessionRecording.status).toBe('active')
            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 100 }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(100)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_minimumDuration']).toBe(1500)

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(1) // the emitted incremental event
            // call the private method to avoid waiting for the timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(posthog.capture).not.toHaveBeenCalled()

            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 1501 }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(2) // two emitted incremental events
            // call the private method to avoid waiting for the timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(posthog.capture).toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(0)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(null)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 1502 }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(1)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(1502)
            // call the private method to avoid waiting for the timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(posthog.capture).toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(0)
        })
    })

    describe('canvas', () => {
        it('passes the remote config to rrweb', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        canvasQuality: '0.2',
                        canvasFps: 6,
                        recordCanvas: true,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()
            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    recordCanvas: true,
                    sampling: { canvas: 6 },
                    dataURLOptions: {
                        type: 'image/webp',
                        quality: 0.2,
                    },
                })
            )
        })

        it('skips when any config variable is missing', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        recordCanvas: null,
                        canvasFps: null,
                        canvasQuality: null,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            const mockParams = assignableWindow.__PosthogExtensions__.rrweb.record.mock.calls[0][0]
            expect(mockParams).not.toHaveProperty('recordCanvas')
            expect(mockParams).not.toHaveProperty('canvasFps')
            expect(mockParams).not.toHaveProperty('canvasQuality')
        })
    })

    describe('session linking', () => {
        beforeEach(() => {
            addRRwebToWindow()
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            jest.spyOn(sessionRecording['_lazyLoadedSessionRecording'], '_tryAddCustomEvent')
        })

        it('emits session linking events on activity timeout', () => {
            const tryAddCustomEvent = sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent'] as any
            tryAddCustomEvent.mockClear()

            const newSessionId = 'new-session-id'
            const newWindowId = 'new-window-id'

            sessionManager['_sessionIdChangedHandlers'].forEach((handler) => {
                handler(newSessionId, newWindowId, {
                    noSessionId: false,
                    activityTimeout: true,
                    sessionPastMaximumLength: false,
                })
            })

            expect(tryAddCustomEvent).toHaveBeenCalledWith('$session_ending', {
                currentSessionId: sessionId,
                currentWindowId: 'windowId',
                nextSessionId: newSessionId,
                nextWindowId: newWindowId,
                changeReason: {
                    noSessionId: false,
                    activityTimeout: true,
                    sessionPastMaximumLength: false,
                },
                lastActivityTimestamp: expect.any(Number),
                flushed_size: 0,
            })

            expect(tryAddCustomEvent).toHaveBeenCalledWith('$session_id_change', {
                sessionId: newSessionId,
                windowId: newWindowId,
                changeReason: {
                    noSessionId: false,
                    activityTimeout: true,
                    sessionPastMaximumLength: false,
                },
            })

            expect(tryAddCustomEvent).toHaveBeenCalledWith('$session_starting', {
                previousSessionId: sessionId,
                previousWindowId: 'windowId',
                nextSessionId: newSessionId,
                nextWindowId: newWindowId,
                changeReason: {
                    noSessionId: false,
                    activityTimeout: true,
                    sessionPastMaximumLength: false,
                },
                lastActivityTimestamp: expect.any(Number),
            })

            expect(tryAddCustomEvent).toHaveBeenCalledTimes(3)
        })

        it('emits session linking events on session past maximum length', () => {
            const tryAddCustomEvent = sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent'] as any
            tryAddCustomEvent.mockClear()

            const newSessionId = 'new-session-id-2'
            const newWindowId = 'new-window-id-2'

            sessionManager['_sessionIdChangedHandlers'].forEach((handler) => {
                handler(newSessionId, newWindowId, {
                    noSessionId: false,
                    activityTimeout: false,
                    sessionPastMaximumLength: true,
                })
            })

            expect(tryAddCustomEvent).toHaveBeenCalledWith('$session_ending', {
                currentSessionId: sessionId,
                currentWindowId: 'windowId',
                nextSessionId: newSessionId,
                nextWindowId: newWindowId,
                changeReason: {
                    noSessionId: false,
                    activityTimeout: false,
                    sessionPastMaximumLength: true,
                },
                lastActivityTimestamp: expect.any(Number),
                flushed_size: 0,
            })

            expect(tryAddCustomEvent).toHaveBeenCalledWith('$session_starting', {
                previousSessionId: sessionId,
                previousWindowId: 'windowId',
                nextSessionId: newSessionId,
                nextWindowId: newWindowId,
                changeReason: {
                    noSessionId: false,
                    activityTimeout: false,
                    sessionPastMaximumLength: true,
                },
                lastActivityTimestamp: expect.any(Number),
            })

            expect(tryAddCustomEvent).toHaveBeenCalledTimes(3)
        })

        it('includes flushed_size with actual data size in session ending event', () => {
            const tryAddCustomEvent = sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent'] as any

            // emit some events to create data to flush
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            // manually flush the buffer to simulate data being sent
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            // verify data was tracked
            const flushedSize =
                sessionRecording['_lazyLoadedSessionRecording']['_flushedSizeTracker'].currentTrackedSize
            expect(flushedSize).toBeGreaterThan(0)

            // clear the mock to only track calls from session change
            tryAddCustomEvent.mockClear()

            const newSessionId = 'new-session-id-with-flushed-data'
            const newWindowId = 'new-window-id-with-flushed-data'

            sessionManager['_sessionIdChangedHandlers'].forEach((handler) => {
                handler(newSessionId, newWindowId, {
                    noSessionId: false,
                    activityTimeout: true,
                    sessionPastMaximumLength: false,
                })
            })

            // should capture the flushed size from the ending session
            expect(tryAddCustomEvent).toHaveBeenCalledWith('$session_ending', {
                currentSessionId: sessionId,
                currentWindowId: 'windowId',
                nextSessionId: newSessionId,
                nextWindowId: newWindowId,
                changeReason: {
                    noSessionId: false,
                    activityTimeout: true,
                    sessionPastMaximumLength: false,
                },
                lastActivityTimestamp: undefined,
                flushed_size: flushedSize,
            })

            // after session change, flushed size should be reset to 0
            expect(sessionRecording['_lazyLoadedSessionRecording']['_flushedSizeTracker'].currentTrackedSize).toBe(0)
        })

        it('does NOT emit linking events when only noSessionId is true (like after reset)', () => {
            const tryAddCustomEvent = sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent'] as any
            tryAddCustomEvent.mockClear()

            const newSessionId = 'new-session-after-reset'
            const newWindowId = 'new-window-after-reset'

            sessionManager['_sessionIdChangedHandlers'].forEach((handler) => {
                handler(newSessionId, newWindowId, {
                    noSessionId: true,
                    activityTimeout: false,
                    sessionPastMaximumLength: false,
                })
            })

            expect(tryAddCustomEvent).not.toHaveBeenCalledWith('$session_ending', expect.anything())
            expect(tryAddCustomEvent).not.toHaveBeenCalledWith('$session_starting', expect.anything())

            expect(tryAddCustomEvent).toHaveBeenCalledWith('$session_id_change', {
                sessionId: newSessionId,
                windowId: newWindowId,
                changeReason: {
                    noSessionId: true,
                    activityTimeout: false,
                    sessionPastMaximumLength: false,
                },
            })

            expect(tryAddCustomEvent).toHaveBeenCalledTimes(1)
        })

        it('always emits $session_id_change event regardless of change reason', () => {
            const tryAddCustomEvent = sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent'] as any

            const testCases = [
                { noSessionId: true, activityTimeout: false, sessionPastMaximumLength: false },
                { noSessionId: false, activityTimeout: true, sessionPastMaximumLength: false },
                { noSessionId: false, activityTimeout: false, sessionPastMaximumLength: true },
            ]

            testCases.forEach((changeReason, index) => {
                tryAddCustomEvent.mockClear()
                const newSessionId = `session-${index}`
                const newWindowId = `window-${index}`

                sessionManager['_sessionIdChangedHandlers'].forEach((handler) => {
                    handler(newSessionId, newWindowId, changeReason)
                })

                expect(tryAddCustomEvent).toHaveBeenCalledWith(
                    '$session_id_change',
                    expect.objectContaining({
                        sessionId: newSessionId,
                        windowId: newWindowId,
                    })
                )
            })
        })

        it('routes $session_starting and $session_ending events to correct session IDs', () => {
            const currentSessionId = sessionId
            const currentWindowId = 'windowId'
            const newSessionId = 'new-session-id'
            const newWindowId = 'new-window-id'

            // Spy on posthog.capture to verify session IDs
            const captureSpy = jest.spyOn(posthog, 'capture')
            captureSpy.mockClear()

            // Create a $session_ending event with payload containing session IDs
            const sessionEndingEvent = createCustomSnapshot(
                {},
                {
                    currentSessionId: currentSessionId,
                    currentWindowId: currentWindowId,
                    nextSessionId: newSessionId,
                    nextWindowId: newWindowId,
                    lastActivityTimestamp: Date.now(),
                },
                '$session_ending'
            )

            // Emit the $session_ending event
            _emit(sessionEndingEvent)

            // Flush to capture
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            // Verify $session_ending is routed to currentSessionId (old session)
            expect(captureSpy).toHaveBeenCalledWith(
                '$snapshot',
                expect.objectContaining({
                    $session_id: currentSessionId,
                    $window_id: currentWindowId,
                    $snapshot_data: expect.arrayContaining([
                        expect.objectContaining({
                            type: EventType.Custom,
                            data: expect.objectContaining({ tag: '$session_ending' }),
                        }),
                    ]),
                }),
                expect.anything()
            )

            captureSpy.mockClear()

            // Now simulate session ID change on the recorder instance
            // This would normally happen via stop/start in _onSessionIdCallback
            sessionRecording['_lazyLoadedSessionRecording']['_sessionId'] = newSessionId
            sessionRecording['_lazyLoadedSessionRecording']['_windowId'] = newWindowId
            sessionRecording['_lazyLoadedSessionRecording']['_buffer'] = {
                size: 0,
                data: [],
                sessionId: newSessionId,
                windowId: newWindowId,
            }

            // Create a $session_starting event with payload containing session IDs
            const sessionStartingEvent = createCustomSnapshot(
                {},
                {
                    previousSessionId: currentSessionId,
                    previousWindowId: currentWindowId,
                    nextSessionId: newSessionId,
                    nextWindowId: newWindowId,
                    lastActivityTimestamp: Date.now(),
                },
                '$session_starting'
            )

            // Emit the $session_starting event
            _emit(sessionStartingEvent)

            // Flush to capture
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            // Verify $session_starting is routed to nextSessionId (new session)
            expect(captureSpy).toHaveBeenCalledWith(
                '$snapshot',
                expect.objectContaining({
                    $session_id: newSessionId,
                    $window_id: newWindowId,
                    $snapshot_data: expect.arrayContaining([
                        expect.objectContaining({
                            type: EventType.Custom,
                            data: expect.objectContaining({ tag: '$session_starting' }),
                        }),
                    ]),
                }),
                expect.anything()
            )
        })

        it('uses targetSessionId from event payload to correctly route lifecycle events', () => {
            const oldSessionId = sessionId
            const newSessionId = 'new-session-after-change'

            // Ensure recorder is not idle
            sessionRecording['_lazyLoadedSessionRecording']['_isIdle'] = false

            // Emit an event to the old session
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(1)

            // Now simulate the recorder instance having transitioned to the new session
            // (This happens in _onSessionIdCallback after stop/start)
            sessionRecording['_lazyLoadedSessionRecording']['_sessionId'] = newSessionId
            sessionRecording['_lazyLoadedSessionRecording']['_windowId'] = 'new-window-id'

            // Emit a $session_starting event for the NEW session
            // Even though the buffer still has the old sessionId, this event should be routed to the new session
            const sessionStartingEvent = createCustomSnapshot(
                {},
                {
                    previousSessionId: oldSessionId,
                    previousWindowId: 'windowId',
                    nextSessionId: newSessionId,
                    nextWindowId: 'new-window-id',
                    lastActivityTimestamp: Date.now(),
                },
                '$session_starting'
            )

            _emit(sessionStartingEvent)

            // The buffer should now have been flushed because buffer.sessionId (old) !== targetSessionId (new)
            // and a new buffer should be created with the new session ID
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].sessionId).toBe(newSessionId)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].windowId).toBe('new-window-id')

            // The buffer should only have the new event, not the old one
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(1)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data[0].data.tag).toBe(
                '$session_starting'
            )
        })
    })

    describe('URL masking with maskCapturedNetworkRequestFn', () => {
        it('uses maskCapturedNetworkRequestFn to mask page URLs when configured', () => {
            const maskFn = jest.fn((data) => {
                // CapturedNetworkRequest uses 'name' for the URL
                if (data.name) {
                    return { ...data, name: data.name.replace(/token=[^&]+/, 'token=[REDACTED]') }
                }
                return data
            })

            posthog.config.session_recording.maskCapturedNetworkRequestFn = maskFn

            addRRwebToWindow()
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            sessionRecording['_onScriptLoaded']()

            // Emit a meta event with a URL containing a sensitive token
            _emit(
                createMetaSnapshot({
                    data: { href: 'https://example.com/?token=secret123&other=value' },
                })
            )
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            // Verify the masking function was called with 'name' property
            expect(maskFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'https://example.com/?token=secret123&other=value',
                })
            )

            // Verify the URL was masked in the captured snapshot
            expect(posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                expect.objectContaining({
                    $snapshot_data: [
                        expect.objectContaining({
                            data: {
                                href: 'https://example.com/?token=[REDACTED]&other=value',
                            },
                        }),
                    ],
                }),
                expect.anything()
            )
        })

        it('falls back to deprecated maskNetworkRequestFn when maskCapturedNetworkRequestFn is not set', () => {
            const deprecatedMaskFn = jest.fn((data) => {
                if (data.url) {
                    return { ...data, url: data.url.replace(/token=[^&]+/, 'token=[REDACTED]') }
                }
                return data
            })

            posthog.config.session_recording.maskNetworkRequestFn = deprecatedMaskFn

            addRRwebToWindow()
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            sessionRecording['_onScriptLoaded']()

            // Emit a meta event with a URL containing a sensitive token
            _emit(
                createMetaSnapshot({
                    data: { href: 'https://example.com/?token=secret123' },
                })
            )
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            // Verify the deprecated masking function was called
            expect(deprecatedMaskFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://example.com/?token=secret123',
                })
            )

            // Verify the URL was masked
            expect(posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                expect.objectContaining({
                    $snapshot_data: [
                        expect.objectContaining({
                            data: {
                                href: 'https://example.com/?token=[REDACTED]',
                            },
                        }),
                    ],
                }),
                expect.anything()
            )
        })

        it('prefers maskCapturedNetworkRequestFn over deprecated maskNetworkRequestFn', () => {
            const newMaskFn = jest.fn((data) => ({ ...data, name: 'masked-by-new' }))
            const deprecatedMaskFn = jest.fn((data) => ({ ...data, url: 'masked-by-deprecated' }))

            posthog.config.session_recording.maskCapturedNetworkRequestFn = newMaskFn
            posthog.config.session_recording.maskNetworkRequestFn = deprecatedMaskFn

            addRRwebToWindow()
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            sessionRecording['_onScriptLoaded']()

            _emit(
                createMetaSnapshot({
                    data: { href: 'https://example.com/?token=secret' },
                })
            )
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            // Should only call the new function, not the deprecated one
            expect(newMaskFn).toHaveBeenCalled()
            expect(deprecatedMaskFn).not.toHaveBeenCalled()

            // Should use the result from the new function
            expect(posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                expect.objectContaining({
                    $snapshot_data: [
                        expect.objectContaining({
                            data: {
                                href: 'masked-by-new',
                            },
                        }),
                    ],
                }),
                expect.anything()
            )
        })

        it('supports backward compatibility when maskCapturedNetworkRequestFn returns url instead of name', () => {
            // Some users might mistakenly return 'url' property instead of 'name'
            const maskFn = jest.fn((data) => {
                if (data.name) {
                    return { url: data.name.replace(/token=[^&]+/, 'token=[REDACTED]') }
                }
                return data
            })

            posthog.config.session_recording.maskCapturedNetworkRequestFn = maskFn

            addRRwebToWindow()
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            sessionRecording['_onScriptLoaded']()

            _emit(
                createMetaSnapshot({
                    data: { href: 'https://example.com/?token=secret123' },
                })
            )
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            // Verify the masking function was called with 'name' property
            expect(maskFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'https://example.com/?token=secret123',
                })
            )

            // Should still work even though user returned 'url' instead of 'name'
            expect(posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                expect.objectContaining({
                    $snapshot_data: [
                        expect.objectContaining({
                            data: {
                                href: 'https://example.com/?token=[REDACTED]',
                            },
                        }),
                    ],
                }),
                expect.anything()
            )
        })
    })

    describe('stale config retry on script loaded', () => {
        const FIVE_MINUTES_IN_MS = 5 * 60 * 1000

        beforeEach(() => {
            addRRwebToWindow()
        })

        it('requests fresh config when persisted config is stale', () => {
            posthog.persistence?.register({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                    cache_timestamp: Date.now() - FIVE_MINUTES_IN_MS - 1000,
                },
            })

            sessionRecording.startIfEnabledOrStop()

            expect(mockRemoteConfigLoad).toHaveBeenCalledTimes(1)
            expect(sessionRecording.started).toBe(false)
        })

        it('does not request fresh config more than once', () => {
            posthog.persistence?.register({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                    cache_timestamp: Date.now() - FIVE_MINUTES_IN_MS - 1000,
                },
            })

            sessionRecording.startIfEnabledOrStop()
            sessionRecording.startIfEnabledOrStop()

            expect(mockRemoteConfigLoad).toHaveBeenCalledTimes(1)
        })

        it('starts recording after fresh config arrives', () => {
            posthog.persistence?.register({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                    cache_timestamp: Date.now() - FIVE_MINUTES_IN_MS - 1000,
                },
            })

            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording.started).toBe(false)

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(sessionRecording.started).toBe(true)
        })
    })
})
