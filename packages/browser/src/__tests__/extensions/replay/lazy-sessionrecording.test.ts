/// <reference lib="dom" />

import '@testing-library/jest-dom'

import { PostHogPersistence } from '../../../posthog-persistence'
import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_ID,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_OVERRIDE_SAMPLING,
    SESSION_RECORDING_REMOTE_CONFIG,
    SESSION_RECORDING_SAMPLE_RATE,
} from '../../../constants'
import { SessionIdManager } from '../../../sessionid'
import { resetSessionStorageSupported } from '../../../storage'
import { createMockPostHog, createMockConfig } from '../../helpers/posthog-instance'
import {
    FULL_SNAPSHOT_EVENT_TYPE,
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
} from '@posthog/browser-common/replay/external/sessionrecording-utils'
import { PostHog } from '../../../posthog-core'
import {
    CapturedNetworkRequest,
    FlagsResponse,
    NetworkRecordOptions,
    PerformanceCaptureConfig,
    PostHogConfig,
    Property,
    RemoteConfig,
    RemoteConfigResult,
    SessionIdChangedCallback,
} from '../../../types'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../../../utils/globals'
import { RequestRouter } from '../../../utils/request-router'
import {
    type customEvent,
    EventType,
    IncrementalSource,
    type eventWithTime,
    type fullSnapshotEvent,
    type incrementalData,
    type incrementalSnapshotEvent,
    type metaEvent,
} from '@posthog/browser-common/replay/rrweb-types'
import { ConsentManager } from '../../../consent'
import { SimpleEventEmitter } from '@posthog/browser-common/utils/simple-event-emitter'
import Mock = vi.Mock
import { SessionRecording } from '../../../extensions/replay/session-recording'
import {
    LazyLoadedSessionRecording,
    RECORDING_IDLE_THRESHOLD_MS,
    RECORDING_BUFFER_TIMEOUT,
    RECORDING_MAX_EVENT_SIZE,
    RECORDING_REMOTE_CONFIG_TTL_MS,
    PENDING_BUFFER_STORAGE_SUFFIX,
} from '../../../extensions/replay/external/lazy-loaded-session-recorder'

// Type and source defined here designate a non-user-generated recording event

vi.mock('../../../config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../config')>()
    return {
        ...actual,
        default: { ...actual.default, LIB_VERSION: '0.0.1', LIB_NAME: 'web' },
        LIB_VERSION: '0.0.1',
        LIB_NAME: 'web',
    }
})

const { mockRemoteConfigLoad } = vi.hoisted(() => ({ mockRemoteConfigLoad: vi.fn() }))
vi.mock('../../../remote-config', () => ({
    RemoteConfigLoader: vi.fn().mockImplementation(() => ({
        load: mockRemoteConfigLoad,
    })),
}))

const createMetaSnapshot = (event = {}): metaEvent =>
    ({
        type: META_EVENT_TYPE,
        data: {
            href: 'https://has-to-be-present-or-invalid.com',
        },
        ...event,
    }) as metaEvent

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

function makeFlagsResponse(partialResponse: Partial<FlagsResponse>): RemoteConfigResult {
    return { ok: true, config: partialResponse as unknown as RemoteConfig }
}

const originalLocation = window!.location

function fakeNavigateTo(href: string) {
    delete (window as any).location
    // @ts-expect-error this is a test, it's safe to write to location like this
    window!.location = { href } as Location
}

describe('Lazy SessionRecording', () => {
    const _addCustomEvent = vi.fn()
    const loadScriptMock = vi.fn()
    let _emit: any
    let posthog: PostHog
    let sessionRecording: SessionRecording
    let sessionId: string
    let sessionManager: SessionIdManager
    let config: PostHogConfig
    let sessionIdGeneratorMock: Mock
    let windowIdGeneratorMock: Mock
    let removePageviewCaptureHookMock: Mock

    // staging for tests that are not about hold semantics: drop the fresh-start interaction hold
    function releaseInteractionHold(): void {
        sessionRecording['_lazyLoadedSessionRecording']['_holdFlushUntilInteraction'] = false
    }
    let simpleEventEmitter: SimpleEventEmitter

    const mockVisibilityHistory = (...states: Array<'hidden' | 'visible'>): { mockRestore: () => void } => {
        const hadOwnProperty = Object.prototype.hasOwnProperty.call(window!.performance, 'getEntriesByType')
        const originalDescriptor = Object.getOwnPropertyDescriptor(window!.performance, 'getEntriesByType')
        Object.defineProperty(window!.performance, 'getEntriesByType', {
            configurable: true,
            value: vi.fn((entryType: string) =>
                entryType === 'visibility-state' ? states.map((name) => ({ name }) as PerformanceEntry) : []
            ),
        })

        return {
            mockRestore: () => {
                if (hadOwnProperty && originalDescriptor) {
                    Object.defineProperty(window!.performance, 'getEntriesByType', originalDescriptor)
                } else {
                    delete (window!.performance as Partial<Performance>).getEntriesByType
                }
            },
        }
    }

    const addRRwebToWindow = () => {
        assignableWindow.__PosthogExtensions__.rrweb = {
            record: vi.fn(({ emit }) => {
                _emit = emit
                return () => {}
            }),
            version: 'fake',
            wasMaxDepthReached: vi.fn(() => false),
            resetMaxDepthState: vi.fn(),
            getLastSnapshotCost: vi.fn(() => null),
            getMutationCost: vi.fn(() => ({ slowestBatchMs: 0 })),
            getDeferredStylesheetStats: vi.fn(() => ({
                deferredCount: 0,
                failedCount: 0,
                abandonedCount: 0,
                totalMs: 0,
                slowestSliceMs: 0,
            })),
            getDiscardedDurationSamples: vi.fn(() => 0),
            getObserverInitFailures: vi.fn(() => undefined),
            resetSnapshotCostState: vi.fn(),
        }
        assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot = vi.fn(() => {
            // we pretend to be rrweb and call emit
            _emit(createFullSnapshot())
        })
        assignableWindow.__PosthogExtensions__.rrweb.record.addCustomEvent = _addCustomEvent
        assignableWindow.__PosthogExtensions__.rrweb.record.mirror = {
            getId: (node) => (!node || !document.contains(node) ? -1 : node.nodeName === 'LINK' ? -2 : 1),
            getNode: () => null,
        }

        assignableWindow.__PosthogExtensions__.rrwebPlugins = {
            getRecordConsolePlugin: vi.fn(),
        }

        assignableWindow.__PosthogExtensions__.initSessionRecording = (_ph, documentWasEverVisible) => {
            return new LazyLoadedSessionRecording(posthog, documentWasEverVisible)
        }
    }

    beforeEach(() => {
        mockRemoteConfigLoad.mockClear()
        removePageviewCaptureHookMock = vi.fn()
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

        sessionIdGeneratorMock = vi.fn().mockImplementation(() => sessionId)
        windowIdGeneratorMock = vi.fn().mockImplementation(() => 'windowId')

        const postHogPersistence = new PostHogPersistence(config)
        postHogPersistence.clear()

        sessionManager = new SessionIdManager(
            createMockPostHog({ config, persistence: postHogPersistence, register: vi.fn() }),
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
            capture: vi.fn(),
            persistence: postHogPersistence,
            onFeatureFlags: () => () => {},
            sessionManager: sessionManager,
            requestRouter: new RequestRouter({ config } as any),
            consent: {
                isOptedOut(): boolean {
                    return false
                },
            } as unknown as ConsentManager,
            register_for_session() {},
            _internalEventEmitter: simpleEventEmitter,
            on: vi.fn().mockImplementation((event, cb) => {
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

        posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
        sessionRecording = new SessionRecording(posthog)
        sessionRecording.setup(posthog._getBrowserClientAdapter())
    })

    afterEach(() => {
        sessionRecording.stopRecording()
        // @ts-expect-error this is a test, it's safe to write to location like this
        window!.location = originalLocation
    })

    describe('before remote config', () => {
        it('does not ship a held fresh recording when the document was never visible', () => {
            const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
            const visibilityHistory = mockVisibilityHistory('hidden')
            try {
                posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
                sessionRecording = new SessionRecording(posthog)
                sessionRecording.setup(posthog._getBrowserClientAdapter())
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                sessionRecording.onRRwebEmit(createFullSnapshot({ timestamp: Date.now() }))
                const snapshot = createCustomSnapshot({ timestamp: Date.now() })
                sessionRecording.onRRwebEmit(snapshot)
                ;(posthog.capture as Mock).mockClear()

                sessionRecording['_lazyLoadedSessionRecording']['_onBeforeUnload']()

                expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
            } finally {
                sessionRecording.stopRecording()
                visibilityHistory.mockRestore()
                visibilityState.mockRestore()
            }
        })

        it('ships when the document was visible before session recording was constructed', () => {
            const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
            const visibilityHistory = mockVisibilityHistory('visible', 'hidden')
            try {
                posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
                sessionRecording = new SessionRecording(posthog)
                sessionRecording.setup(posthog._getBrowserClientAdapter())
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                sessionRecording.onRRwebEmit(createFullSnapshot({ timestamp: Date.now() }))
                const snapshot = createCustomSnapshot({ timestamp: Date.now() })
                sessionRecording.onRRwebEmit(snapshot)
                ;(posthog.capture as Mock).mockClear()

                sessionRecording['_lazyLoadedSessionRecording']['_onBeforeUnload']()

                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    expect.objectContaining({ $snapshot_data: expect.arrayContaining([snapshot]) }),
                    expect.any(Object)
                )
            } finally {
                sessionRecording.stopRecording()
                visibilityHistory.mockRestore()
                visibilityState.mockRestore()
            }
        })

        it('preserves unload shipping when an older core omits visibility history', () => {
            const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
            try {
                loadScriptMock.mockImplementation((_ph, _path, callback) => {
                    addRRwebToWindow()
                    assignableWindow.__PosthogExtensions__.initSessionRecording = (ph) =>
                        new LazyLoadedSessionRecording(ph)
                    callback()
                })
                posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
                sessionRecording = new SessionRecording(posthog)
                sessionRecording.setup(posthog._getBrowserClientAdapter())
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                sessionRecording.onRRwebEmit(createFullSnapshot({ timestamp: Date.now() }))
                const snapshot = createCustomSnapshot({ timestamp: Date.now() })
                sessionRecording.onRRwebEmit(snapshot)
                ;(posthog.capture as Mock).mockClear()

                sessionRecording['_lazyLoadedSessionRecording']['_onBeforeUnload']()

                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    expect.objectContaining({ $snapshot_data: expect.arrayContaining([snapshot]) }),
                    expect.any(Object)
                )
            } finally {
                sessionRecording.stopRecording()
                visibilityState.mockRestore()
            }
        })

        it('ships when the document becomes visible before the lazy recorder is constructed', () => {
            const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
            const visibilityHistory = mockVisibilityHistory('hidden')
            try {
                posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
                sessionRecording = new SessionRecording(posthog)
                sessionRecording.setup(posthog._getBrowserClientAdapter())
                visibilityState.mockReturnValue('visible')
                document.dispatchEvent(new Event('visibilitychange'))
                visibilityState.mockReturnValue('hidden')
                document.dispatchEvent(new Event('visibilitychange'))

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                sessionRecording.onRRwebEmit(createFullSnapshot({ timestamp: Date.now() }))
                const snapshot = createCustomSnapshot({ timestamp: Date.now() })
                sessionRecording.onRRwebEmit(snapshot)
                ;(posthog.capture as Mock).mockClear()

                sessionRecording['_lazyLoadedSessionRecording']['_onBeforeUnload']()

                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    expect.objectContaining({ $snapshot_data: expect.arrayContaining([snapshot]) }),
                    expect.any(Object)
                )
            } finally {
                sessionRecording.stopRecording()
                visibilityHistory.mockRestore()
                visibilityState.mockRestore()
            }
        })

        it('ships once a background document becomes visible after the lazy recorder is constructed', () => {
            const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
            const visibilityHistory = mockVisibilityHistory('hidden')
            try {
                posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
                sessionRecording = new SessionRecording(posthog)
                sessionRecording.setup(posthog._getBrowserClientAdapter())
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                sessionRecording.onRRwebEmit(createFullSnapshot({ timestamp: Date.now() }))
                const snapshot = createCustomSnapshot({ timestamp: Date.now() })
                sessionRecording.onRRwebEmit(snapshot)
                ;(posthog.capture as Mock).mockClear()

                visibilityState.mockReturnValue('visible')
                document.dispatchEvent(new Event('visibilitychange'))
                visibilityState.mockReturnValue('hidden')
                document.dispatchEvent(new Event('visibilitychange'))
                sessionRecording['_lazyLoadedSessionRecording']['_onBeforeUnload']()

                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    expect.objectContaining({ $snapshot_data: expect.arrayContaining([snapshot]) }),
                    expect.any(Object)
                )
            } finally {
                sessionRecording.stopRecording()
                visibilityHistory.mockRestore()
                visibilityState.mockRestore()
            }
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

        describe('network capture plugin', () => {
            it('filters ingestion paths when rewriteRequestPath is configured after the plugin starts', () => {
                const getRecordNetworkPlugin = vi.fn((options: NetworkRecordOptions) => ({
                    name: 'network',
                    observer: undefined,
                    options,
                }))
                assignableWindow.__PosthogExtensions__!.rrwebPlugins = { getRecordNetworkPlugin }
                posthog.config.session_recording.recordBody = true

                const lazyLoadedSessionRecording = new LazyLoadedSessionRecording(posthog, true)
                lazyLoadedSessionRecording['_forceAllowLocalhostNetworkCapture'] = true
                lazyLoadedSessionRecording['_gatherRRWebPlugins']()

                const networkOptions = getRecordNetworkPlugin.mock.calls[0][0]
                posthog.config.rewriteRequestPath = (url) => {
                    if (url.pathname === '/s/') {
                        url.pathname = '/custom-replay/'
                    }
                    return url
                }
                const rewrittenEndpoint = posthog.requestRouter.endpointFor('api', '/s/')

                expect(
                    networkOptions.maskRequestFn!({
                        name: rewrittenEndpoint,
                    } as CapturedNetworkRequest)
                ).toBeUndefined()
            })
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
                    sizes: [],
                    sessionId: sessionId,
                    size: 0,
                    windowId: 'windowId',
                })

                // options will have been emitted
                expect(_addCustomEvent).toHaveBeenCalled()
                _addCustomEvent.mockClear()
            })

            afterEach(() => {
                vi.useRealTimers()
            })

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
                    sizes: [68],
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
                    sizes: expect.any(Array),
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
                    sizes: [],
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
                        $snapshot_host: 'localhost',
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
                    // the mutation that triggered idle was dropped, so returning from idle
                    // captures a full snapshot _before_ the fourth snapshot to re-sync the player
                    data: [createFullSnapshot(), fourthSnapshot],
                    sizes: [20, 68],
                    sessionId: firstSessionId,
                    size: 88,
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
                    sizes: [68],
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
                    sizes: expect.any(Array),
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
                    sizes: [],
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
                        $snapshot_host: 'localhost',
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
                vi.useFakeTimers().setSystemTime(new Date(fourthActivityTimestamp))
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
                        $snapshot_host: 'localhost',
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
                    sizes: [68],
                    sessionId: rotatedSessionId,
                    size: 68,
                    windowId: expect.any(String),
                })
            })

            it('restarts recorder when session rotates externally while idle', () => {
                // Regression test: analytics events (e.g. $pageleave, $exception) can trigger
                // session rotation via checkAndGetSessionAndWindowId in posthog-core while the
                // recorder is idle. _onSessionIdCallback must restart the recorder in this case
                // because _updateWindowAndSessionIds returns early when _isIdle is true.
                const firstActivityTimestamp = startingTimestamp + 100
                const idleTriggerTimestamp = startingTimestamp + RECORDING_IDLE_THRESHOLD_MS + 1000
                // past the session timeout so the session manager will rotate
                const rotationTimestamp = sessionManager['_sessionTimeoutMs'] + startingTimestamp + 1000

                // Step 1: emit an active event to establish the session
                emitActiveEvent(firstActivityTimestamp)
                const firstSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']

                // Step 2: prepare a rotated session ID for when the session manager rotates
                sessionIdGeneratorMock.mockClear()
                const rotatedSessionId = 'externally-rotated-session-id'
                sessionIdGeneratorMock.mockImplementation(() => rotatedSessionId)

                // Step 3: trigger idle state via an inactive event after the idle threshold
                emitInactiveEvent(idleTriggerTimestamp, true)
                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual(true)

                // Step 4: simulate what happens when an analytics event (e.g. $pageleave)
                // triggers session rotation. In production, posthog-core calls
                // checkAndGetSessionAndWindowId() during _calculate_event_properties,
                // which rotates the session in the session manager and then fires the
                // _onSessionIdCallback synchronously.
                vi.useFakeTimers().setSystemTime(new Date(rotationTimestamp))
                const { sessionId: newSessionId } = sessionManager.checkAndGetSessionAndWindowId(
                    false,
                    rotationTimestamp
                )
                expect(newSessionId).toEqual(rotatedSessionId)
                expect(newSessionId).not.toEqual(firstSessionId)

                // The session manager fires _onSessionIdCallback synchronously during
                // checkAndGetSessionAndWindowId, so the recorder should have already restarted
                const recorderSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']
                expect(recorderSessionId).toEqual(rotatedSessionId)
            })

            it('restarts recorder when session rotates via forcedIdleReset', () => {
                // After forcedIdleReset, _isIdle is 'unknown' and rrweb is stopped; the
                // session-id callback must still restart so the new session gets a full snapshot.
                const firstActivityTimestamp = startingTimestamp + 100
                const idleTriggerTimestamp = startingTimestamp + RECORDING_IDLE_THRESHOLD_MS + 1000

                emitActiveEvent(firstActivityTimestamp)
                const firstSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']

                const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as Mock
                expect(recordMock).toHaveBeenCalledTimes(1)

                emitInactiveEvent(idleTriggerTimestamp, true)
                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual(true)

                sessionIdGeneratorMock.mockClear()
                const rotatedSessionId = 'forced-idle-rotated-session-id'
                sessionIdGeneratorMock.mockImplementation(() => rotatedSessionId)
                sessionManager.resetSessionId()
                sessionManager['_eventEmitter'].emit('forcedIdleReset', { idleSessionId: firstSessionId })

                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual('unknown')
                expect(sessionRecording['_lazyLoadedSessionRecording']['isStarted']).toEqual(false)

                const rotationTimestamp = idleTriggerTimestamp + 1000
                vi.useFakeTimers().setSystemTime(new Date(rotationTimestamp))
                const { sessionId: newSessionId } = sessionManager.checkAndGetSessionAndWindowId(
                    false,
                    rotationTimestamp
                )
                expect(newSessionId).toEqual(rotatedSessionId)
                expect(newSessionId).not.toEqual(firstSessionId)

                expect(recordMock).toHaveBeenCalledTimes(2)
                expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionId']).toEqual(rotatedSessionId)
                expect(sessionRecording['_lazyLoadedSessionRecording']['isStarted']).toEqual(true)
            })

            it('restarts recorder when session rotates externally while _isIdle is unknown', () => {
                // Regression test for #4202: a tab that never sees user interaction keeps
                // _isIdle === 'unknown'. An analytics event can still rotate the session via
                // activityTimeout; the recorder must follow the rotation or every later event
                // ships under the old session id and the new session never gets a full snapshot.
                expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual('unknown')
                const firstSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']
                const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as Mock
                expect(recordMock).toHaveBeenCalledTimes(1)

                sessionIdGeneratorMock.mockClear()
                const rotatedSessionId = 'unknown-idle-rotated-session-id'
                sessionIdGeneratorMock.mockImplementation(() => rotatedSessionId)

                const rotationTimestamp = sessionManager['_sessionTimeoutMs'] + startingTimestamp + 1000
                vi.useFakeTimers().setSystemTime(new Date(rotationTimestamp))
                const { sessionId: newSessionId } = sessionManager.checkAndGetSessionAndWindowId(
                    false,
                    rotationTimestamp
                )
                expect(newSessionId).toEqual(rotatedSessionId)
                expect(newSessionId).not.toEqual(firstSessionId)

                // the session-id callback restarts the recorder immediately
                expect(recordMock).toHaveBeenCalledTimes(2)
                expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionId']).toEqual(rotatedSessionId)

                // and post-rotation events are attributed to the new session
                emitInactiveEvent(rotationTimestamp + 100, 'unknown')
                expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].sessionId).toEqual(rotatedSessionId)
            })

            describe('holding rotation-born sessions until interaction', () => {
                // Rotation-born sessions that never see user interaction must not ship a
                // billable recording per rotation — a background tab would otherwise produce
                // one recording every ~30 minutes forever. The recorder still restarts and
                // re-syncs ids on rotation (#4202), but holds the buffer until interaction.
                const rotatedSessionId = 'rotation-born-session-id'

                function rotateExternallyWhileUnknown(newSessionId: string = rotatedSessionId): number {
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual('unknown')
                    sessionIdGeneratorMock.mockClear()
                    sessionIdGeneratorMock.mockImplementation(() => newSessionId)

                    const rotationTimestamp = sessionManager['_sessionTimeoutMs'] + startingTimestamp + 1000
                    vi.useFakeTimers().setSystemTime(new Date(rotationTimestamp))
                    const { sessionId: newId } = sessionManager.checkAndGetSessionAndWindowId(false, rotationTimestamp)
                    expect(newId).toEqual(newSessionId)
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionId']).toEqual(newSessionId)
                    ;(posthog.capture as Mock).mockClear()
                    return rotationTimestamp
                }

                it('does not flush a rotation-born session on the timer without interaction', () => {
                    const rotationTimestamp = rotateExternallyWhileUnknown()
                    const snapshot = emitInactiveEvent(rotationTimestamp + 100, 'unknown')
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toContain(snapshot)

                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

                    expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
                    // the data stays buffered rather than being dropped
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toContain(snapshot)
                })

                it('flushes the held buffer on the first interaction, playable from the session start', () => {
                    const rotationTimestamp = rotateExternallyWhileUnknown()
                    const meta = createMetaSnapshot({ timestamp: rotationTimestamp + 10 })
                    const fullSnapshot = createFullSnapshot({ timestamp: rotationTimestamp + 20 })
                    _emit(meta)
                    _emit(fullSnapshot)

                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                    expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())

                    const interaction = emitActiveEvent(rotationTimestamp + 1000)
                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

                    // the held Meta -> FullSnapshot ships under the rotated session id,
                    // batched with the interaction on the normal flush cadence
                    expect(posthog.capture).toHaveBeenCalledWith(
                        '$snapshot',
                        expect.objectContaining({
                            $session_id: rotatedSessionId,
                            $snapshot_data: [meta, fullSnapshot, interaction],
                        }),
                        expect.any(Object)
                    )
                })

                it('discards a held session that rotates again without interaction', () => {
                    const firstRotationTimestamp = rotateExternallyWhileUnknown()
                    emitInactiveEvent(firstRotationTimestamp + 100, 'unknown')

                    sessionIdGeneratorMock.mockImplementation(() => 'second-rotated-session-id')
                    const secondRotationTimestamp = firstRotationTimestamp + sessionManager['_sessionTimeoutMs'] + 1000
                    vi.useFakeTimers().setSystemTime(new Date(secondRotationTimestamp))
                    sessionManager.checkAndGetSessionAndWindowId(false, secondRotationTimestamp)

                    expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionId']).toEqual(
                        'second-rotated-session-id'
                    )
                    // nothing from the held epoch shipped, and no stale data survives into the new epoch
                    expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toEqual([])
                })

                it('rotates a confirmed-idle session at the 24 hour session cap, into a held epoch', () => {
                    // An idle tab must keep consulting the session manager: bailing on the
                    // check is how idle sessions used to blow through SESSION_LENGTH_LIMIT
                    // into multi-day recordings under one session id.
                    const firstActivityTimestamp = startingTimestamp + 100
                    vi.useFakeTimers().setSystemTime(new Date(firstActivityTimestamp))
                    emitActiveEvent(firstActivityTimestamp)

                    const idleTimestamp = firstActivityTimestamp + RECORDING_IDLE_THRESHOLD_MS + 1000
                    vi.setSystemTime(new Date(idleTimestamp))
                    emitInactiveEvent(idleTimestamp, true)
                    const idleSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']

                    // a day later the still-idle tab emits a non-interactive event; the session
                    // is past the maximum length and must rotate even though the tab stayed
                    // idle, and the rotation-born epoch must be held (nobody has interacted)
                    sessionIdGeneratorMock.mockImplementation(() => 'past-cap-rotated-session-id')
                    const pastCapTimestamp = startingTimestamp + 24 * 60 * 60 * 1000 + 1000
                    vi.setSystemTime(new Date(pastCapTimestamp))
                    emitInactiveEvent(pastCapTimestamp, 'unknown')

                    expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionId']).toEqual(
                        'past-cap-rotated-session-id'
                    )
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionId']).not.toEqual(idleSessionId)
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_holdFlushUntilInteraction']).toEqual(true)
                })

                it('does not hold a rotation that happens while the user is active', () => {
                    emitActiveEvent(startingTimestamp + 100)

                    sessionIdGeneratorMock.mockImplementation(() => 'active-rotated-session-id')
                    const rotationTimestamp = sessionManager['_sessionTimeoutMs'] + startingTimestamp + 1000
                    vi.useFakeTimers().setSystemTime(new Date(rotationTimestamp))
                    ;(posthog.capture as Mock).mockClear()
                    const interaction = emitActiveEvent(rotationTimestamp)
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionId']).toEqual(
                        'active-rotated-session-id'
                    )

                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

                    expect(posthog.capture).toHaveBeenCalledWith(
                        '$snapshot',
                        expect.objectContaining({
                            $session_id: 'active-rotated-session-id',
                            $snapshot_data: [interaction],
                        }),
                        expect.any(Object)
                    )
                })

                it('discards a held buffer on stop() instead of shipping it', () => {
                    const rotationTimestamp = rotateExternallyWhileUnknown()
                    emitInactiveEvent(rotationTimestamp + 100, 'unknown')

                    sessionRecording['_lazyLoadedSessionRecording'].stop()

                    expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toEqual([])
                })

                it('discards a held buffer on unload instead of shipping it', () => {
                    const rotationTimestamp = rotateExternallyWhileUnknown()
                    emitInactiveEvent(rotationTimestamp + 100, 'unknown')

                    sessionRecording['_lazyLoadedSessionRecording']['_onBeforeUnload']()

                    expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
                })

                it('holds a fresh start after stop until interaction, then ships', () => {
                    const rotationTimestamp = rotateExternallyWhileUnknown()
                    emitInactiveEvent(rotationTimestamp + 100, 'unknown')

                    const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']
                    lazyRecorder.stop()
                    expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())

                    // a fresh start with no confirmed activity is held just like a
                    // rotation-born epoch — nobody has touched this tab yet
                    lazyRecorder.start()
                    const snapshot = emitInactiveEvent(rotationTimestamp + 200, 'unknown')
                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                    expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
                    expect(lazyRecorder['_buffer'].data).toContain(snapshot)

                    emitActiveEvent(rotationTimestamp + 300)
                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                    expect(posthog.capture).toHaveBeenCalledWith(
                        '$snapshot',
                        expect.objectContaining({ $snapshot_data: expect.arrayContaining([snapshot]) }),
                        expect.any(Object)
                    )
                })

                it('does not clear the hold on a re-entrant start() while a held epoch is live', () => {
                    const rotationTimestamp = rotateExternallyWhileUnknown()
                    const snapshot = emitInactiveEvent(rotationTimestamp + 100, 'unknown')

                    // e.g. a remote-config refresh calling start() again on the live recorder
                    sessionRecording['_lazyLoadedSessionRecording'].start()

                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                    expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toContain(snapshot)
                })

                it('an event trigger match releases the hold even when its activation is a no-op', () => {
                    // triggerMatchType 'any': a URL trigger can satisfy the combined status
                    // before the error fires, so the activation is a no-op except for
                    // releasing the hold.
                    const rotationTimestamp = rotateExternallyWhileUnknown()
                    const snapshot = emitInactiveEvent(rotationTimestamp + 100, 'unknown')

                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                    expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())

                    // no pending triggers in this setup, so this activation is a no-op beyond
                    // releasing the hold, mirroring the already-activated-by-url case
                    sessionRecording['_lazyLoadedSessionRecording']['_activateTrigger']('event', '$exception')

                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                    expect(posthog.capture).toHaveBeenCalledWith(
                        '$snapshot',
                        expect.objectContaining({
                            $session_id: rotatedSessionId,
                            $snapshot_data: expect.arrayContaining([snapshot]),
                        }),
                        expect.any(Object)
                    )
                })

                it('a URL trigger match does not release the hold', () => {
                    // URL triggers scope where recording is allowed, not whether anyone touched the session
                    const rotationTimestamp = rotateExternallyWhileUnknown()
                    const snapshot = emitInactiveEvent(rotationTimestamp + 100, 'unknown')

                    sessionRecording['_lazyLoadedSessionRecording']['_activateTrigger']('url', 'https://example.com')
                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

                    expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toContain(snapshot)
                })

                describe('V2 trigger groups', () => {
                    function applyV2Config(events: { name: string; properties?: any[] }[], urls?: any[]) {
                        sessionRecording.onRemoteConfig(
                            makeFlagsResponse({
                                sessionRecording: {
                                    endpoint: '/s/',
                                    version: 2,
                                    triggerGroups: [
                                        {
                                            id: 'group-1',
                                            name: 'Test Group',
                                            sampleRate: 1.0,
                                            conditions: {
                                                matchType: 'any',
                                                events,
                                                urls,
                                            },
                                        },
                                    ],
                                },
                            })
                        )
                    }

                    function expectHoldRetained(snapshot: eventWithTime) {
                        expect(sessionRecording['_lazyLoadedSessionRecording']['_holdFlushUntilInteraction']).toEqual(
                            true
                        )
                        expect(posthog.capture).not.toHaveBeenCalledWith(
                            '$snapshot',
                            expect.anything(),
                            expect.anything()
                        )
                        expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toContain(snapshot)
                    }

                    it('an event trigger match releases the hold and ships under the rotated session id', () => {
                        applyV2Config([{ name: '$exception' }])

                        const rotationTimestamp = rotateExternallyWhileUnknown()
                        const snapshot = emitInactiveEvent(rotationTimestamp + 100, 'unknown')

                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                        expect(posthog.capture).not.toHaveBeenCalledWith(
                            '$snapshot',
                            expect.anything(),
                            expect.anything()
                        )

                        simpleEventEmitter.emit('eventCaptured', { event: '$exception', properties: {} })
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

                        expect(sessionRecording['_lazyLoadedSessionRecording']['_holdFlushUntilInteraction']).toEqual(
                            false
                        )
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                        expect(posthog.capture).toHaveBeenCalledWith(
                            '$snapshot',
                            expect.objectContaining({
                                $session_id: rotatedSessionId,
                                $snapshot_data: expect.arrayContaining([snapshot]),
                            }),
                            expect.any(Object)
                        )
                    })

                    it('an event trigger whose property filters do not match retains the hold', () => {
                        applyV2Config([
                            {
                                name: '$exception',
                                properties: [{ key: 'level', type: 'event', operator: 'exact', value: 'fatal' }],
                            },
                        ])

                        const rotationTimestamp = rotateExternallyWhileUnknown()
                        const snapshot = emitInactiveEvent(rotationTimestamp + 100, 'unknown')

                        simpleEventEmitter.emit('eventCaptured', {
                            event: '$exception',
                            properties: { level: 'warning' },
                        })
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

                        expectHoldRetained(snapshot)
                    })

                    it('a URL trigger activation does not release the hold', () => {
                        applyV2Config([], [{ url: 'test.com', matching: 'regex' }])
                        fakeNavigateTo('https://test.com/')

                        const rotationTimestamp = rotateExternallyWhileUnknown()
                        // the URL trigger matches on the next emitted event's trigger check
                        const snapshot = emitInactiveEvent(rotationTimestamp + 100, 'unknown')

                        // guard against a vacuous pass: 'sampled' is only reachable once a group's
                        // trigger status is 'trigger_activated' (triggerGroupsMatchSessionRecordingStatus)
                        expect(sessionRecording.status).toBe('sampled')

                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

                        expectHoldRetained(snapshot)
                    })

                    it('releases a hold that begins after the initial-flush unhook optimization', () => {
                        // the eventCaptured hook unhooks itself once the initial flush completes;
                        // a rotation after that must still be releasable because start() builds a
                        // fresh strategy (and hook) for the rotation-born epoch
                        applyV2Config([{ name: '$exception' }])
                        const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']

                        simpleEventEmitter.emit('eventCaptured', { event: '$exception', properties: {} })
                        expect(sessionRecording.status).toBe('active')

                        vi.useFakeTimers().setSystemTime(new Date(startingTimestamp + 100))
                        emitActiveEvent(startingTimestamp + 100)
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                        expect(posthog.capture).toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())

                        // next captured event disconnects the hook on the pre-rotation strategy
                        simpleEventEmitter.emit('eventCaptured', { event: 'anything', properties: {} })
                        expect(lazyRecorder['_strategy']['_removeEventTriggerCaptureHook']).toBeUndefined()

                        // go confirmed-idle, then rotate externally into a held epoch
                        const idleTimestamp = startingTimestamp + 100 + RECORDING_IDLE_THRESHOLD_MS + 1000
                        vi.setSystemTime(new Date(idleTimestamp))
                        emitInactiveEvent(idleTimestamp, true)

                        sessionIdGeneratorMock.mockImplementation(() => 'late-rotated-session-id')
                        const rotationTimestamp = idleTimestamp + sessionManager['_sessionTimeoutMs'] + 1000
                        vi.setSystemTime(new Date(rotationTimestamp))
                        sessionManager.checkAndGetSessionAndWindowId(false, rotationTimestamp)
                        ;(posthog.capture as Mock).mockClear()

                        expect(lazyRecorder['_sessionId']).toEqual('late-rotated-session-id')
                        expect(lazyRecorder['_holdFlushUntilInteraction']).toEqual(true)

                        const snapshot = emitInactiveEvent(rotationTimestamp + 100, 'unknown')
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                        expect(posthog.capture).not.toHaveBeenCalledWith(
                            '$snapshot',
                            expect.anything(),
                            expect.anything()
                        )

                        simpleEventEmitter.emit('eventCaptured', { event: '$exception', properties: {} })
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

                        expect(lazyRecorder['_holdFlushUntilInteraction']).toEqual(false)
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                        expect(posthog.capture).toHaveBeenCalledWith(
                            '$snapshot',
                            expect.objectContaining({
                                $session_id: 'late-rotated-session-id',
                                $snapshot_data: expect.arrayContaining([snapshot]),
                            }),
                            expect.any(Object)
                        )
                    })
                })

                it('ships nothing when recording is stopped (opt-out) with a held epoch', () => {
                    const rotationTimestamp = rotateExternallyWhileUnknown()
                    emitInactiveEvent(rotationTimestamp + 100, 'unknown')

                    sessionRecording.stopRecording()

                    expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
                })

                describe('reporting the hold', () => {
                    // a held epoch reads as 'active' but uploads nothing, so the hold has to
                    // report itself or support cannot tell it from a working recording
                    const holdReason = () =>
                        sessionRecording['_lazyLoadedSessionRecording'].sdkDebugProperties
                            .$sdk_debug_replay_flush_hold_reason

                    it('names a rotation-born hold, and stops naming it once the hold releases', () => {
                        const rotationTimestamp = rotateExternallyWhileUnknown()
                        emitInactiveEvent(rotationTimestamp + 100, 'unknown')

                        expect(holdReason()).toEqual('no_interaction_since_session_rotated')

                        emitActiveEvent(rotationTimestamp + 200)
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

                        expect(holdReason()).toBeUndefined()
                    })

                    it('logs the hold reason once per held epoch', () => {
                        assignableWindow.POSTHOG_DEBUG = true
                        const logSpy = vi.spyOn(window!.console, 'log').mockImplementation(() => {})

                        const rotationTimestamp = rotateExternallyWhileUnknown()
                        emitInactiveEvent(rotationTimestamp + 100, 'unknown')
                        emitInactiveEvent(rotationTimestamp + 200, 'unknown')
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

                        // the logger prepends a prefix arg, so the message is the second call arg
                        const holdLogs = logSpy.mock.calls.filter(
                            (call) => typeof call[1] === 'string' && call[1].includes('holding buffer')
                        )
                        expect(holdLogs).toHaveLength(1)
                        expect(holdLogs[0][1]).toContain('no_interaction_since_session_rotated')

                        logSpy.mockRestore()
                        assignableWindow.POSTHOG_DEBUG = undefined
                    })

                    it('logs one reason for a rotation-born epoch even when the dedup key does not absorb the transient fresh-start hold', () => {
                        // the "logs once" guarantee also has to hold when the previous dedup key
                        // does not happen to match the transient fresh-start hold that start()
                        // sets before the rotation reason overwrites it. A prior rotation leaves a
                        // `...:no_interaction_since_session_rotated` key, so the second rotation's
                        // transient `no_interaction_since_recording_started` no longer collides.
                        assignableWindow.POSTHOG_DEBUG = true
                        const logSpy = vi.spyOn(window!.console, 'log').mockImplementation(() => {})

                        const firstRotationTimestamp = rotateExternallyWhileUnknown()
                        emitInactiveEvent(firstRotationTimestamp + 100, 'unknown')

                        sessionIdGeneratorMock.mockImplementation(() => 'second-rotated-session-id')
                        const secondRotationTimestamp =
                            firstRotationTimestamp + sessionManager['_sessionTimeoutMs'] + 1000
                        vi.useFakeTimers().setSystemTime(new Date(secondRotationTimestamp))
                        logSpy.mockClear()
                        sessionManager.checkAndGetSessionAndWindowId(false, secondRotationTimestamp)

                        const holdLogs = logSpy.mock.calls.filter(
                            (call) => typeof call[1] === 'string' && call[1].includes('holding buffer')
                        )
                        expect(holdLogs).toHaveLength(1)
                        expect(holdLogs[0][1]).toContain('no_interaction_since_session_rotated')

                        logSpy.mockRestore()
                        assignableWindow.POSTHOG_DEBUG = undefined
                    })
                })
            })

            describe('recording volume invariants', () => {
                // Billing-level invariants over long simulated timelines. The mechanics of
                // holding rotation-born sessions are covered above; these assert the outcome
                // that matters regardless of mechanism: how many recordings a tab ships.

                function shippedSessionIds(): Set<string> {
                    return new Set(
                        (posthog.capture as Mock).mock.calls
                            .filter(([eventName]) => eventName === '$snapshot')
                            .map(([, properties]) => properties.$session_id)
                    )
                }

                function emitInactiveWithoutAssertion(activityTimestamp: number): void {
                    _emit({
                        event: 123,
                        type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                        data: { source: 0, adds: [], attributes: [], removes: [], texts: [] },
                        timestamp: activityTimestamp,
                    })
                }

                // An idle tab rotates through two distinct paths, and both must stay silent:
                // - organic: the recorder's own per-emit readOnly session check enforces the
                //   24 hour cap (one rotation per day of pure idleness)
                // - external: another caller rotates the session on the activity timeout
                //   (a sibling tab, or any non-readonly check every ~30 idle minutes); the
                //   recorder hears it via the session manager listener. This is the Jul 2026
                //   incident path: one billed recording per external rotation, unbounded.
                function runOrganicIdleEmits(fromTimestamp: number, days: number): void {
                    let timestamp = fromTimestamp
                    const endTimestamp = fromTimestamp + days * 24 * 60 * 60 * 1000
                    sessionIdGeneratorMock.mockClear()
                    sessionIdGeneratorMock.mockImplementation(() => `volume-organic-${uuidv7()}`)
                    while (timestamp < endTimestamp) {
                        timestamp += sessionManager['_sessionTimeoutMs'] + 1000
                        vi.setSystemTime(new Date(timestamp))
                        emitInactiveWithoutAssertion(timestamp)
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                    }
                    // the readOnly per-emit check must rotate at each 24 hour cap; if this
                    // stops happening, idle tabs accrete multi-day recordings again
                    expect(sessionIdGeneratorMock.mock.calls.length).toBeGreaterThanOrEqual(days)
                }

                function runExternalRotations(fromTimestamp: number, days: number): number {
                    let timestamp = fromTimestamp
                    const endTimestamp = fromTimestamp + days * 24 * 60 * 60 * 1000
                    let rotationCount = 0
                    sessionIdGeneratorMock.mockClear()
                    sessionIdGeneratorMock.mockImplementation(() => `volume-external-${uuidv7()}`)
                    while (timestamp < endTimestamp) {
                        timestamp += sessionManager['_sessionTimeoutMs'] + 1000
                        rotationCount++
                        vi.setSystemTime(new Date(timestamp))
                        sessionManager.checkAndGetSessionAndWindowId(false, timestamp)
                        emitInactiveWithoutAssertion(timestamp + 10)
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                    }
                    // guard against a silent no-op loop: every step must have rotated the session
                    expect(sessionIdGeneratorMock).toHaveBeenCalledTimes(rotationCount)
                    return rotationCount
                }

                beforeEach(() => {
                    vi.useFakeTimers().setSystemTime(new Date(startingTimestamp))
                })

                it('a purely idle tab ships zero recordings across three days of cap rotations', () => {
                    runOrganicIdleEmits(startingTimestamp, 3)

                    expect(shippedSessionIds()).toEqual(new Set())
                })

                it('a tab whose session is rotated externally every idle timeout ships zero recordings across three days', () => {
                    const rotations = runExternalRotations(startingTimestamp, 3)

                    expect(rotations).toBeGreaterThan(100)
                    expect(shippedSessionIds()).toEqual(new Set())
                })

                it('a single interaction ships exactly one session and later idle rotations add none', () => {
                    emitActiveEvent(startingTimestamp + 100)
                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                    expect(shippedSessionIds()).toEqual(new Set([sessionId]))

                    const rotations = runExternalRotations(startingTimestamp + 100, 2)

                    expect(rotations).toBeGreaterThan(50)
                    expect(shippedSessionIds()).toEqual(new Set([sessionId]))
                })

                it('rotations that survive on a TTL-expired remote config still ship zero recordings without interaction', () => {
                    const preservedConfig = posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG) as any
                    posthog.persistence?.register({
                        [SESSION_RECORDING_REMOTE_CONFIG]: {
                            ...preservedConfig,
                            cache_timestamp: Date.now() - RECORDING_REMOTE_CONFIG_TTL_MS - 1,
                        },
                    })

                    const rotations = runExternalRotations(startingTimestamp, 2)

                    expect(rotations).toBeGreaterThan(50)
                    expect(shippedSessionIds()).toEqual(new Set())
                })

                // The Jul 2026 idle-rotation family: an idle tab rotates, the markers for the
                // rotation land in the new session's empty buffer, and shipping them opens a
                // recording that bills the customer and plays back as nothing.
                function rotateToASessionWithNoContent(): void {
                    const rotateAt = startingTimestamp + sessionManager['_sessionTimeoutMs'] + 1000
                    vi.setSystemTime(new Date(rotateAt))
                    sessionIdGeneratorMock.mockImplementation(() => 'rotated-empty-session')
                    sessionManager.checkAndGetSessionAndWindowId(false, rotateAt)
                    releaseInteractionHold()
                    ;(posthog.capture as Mock).mockClear()
                }

                it.each([
                    ['idle markers alone never open a recording', 'sessionIdle', 0],
                    ['session-linking markers still open one, the chain needs them', '$session_ending', 1],
                ])('%s', (_name, tag, expectedRecordings) => {
                    rotateToASessionWithNoContent()

                    _emit(createCustomSnapshot({ timestamp: Date.now() }, {}, tag as string))
                    sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                    expect(shippedSessionIds().size).toEqual(expectedRecordings)
                })

                it('drops held markers once they pass the buffer size cap', () => {
                    rotateToASessionWithNoContent()
                    const lazy = sessionRecording['_lazyLoadedSessionRecording']

                    _emit(createCustomSnapshot({ timestamp: Date.now() }, {}, 'sessionIdle'))
                    lazy['_buffer'].size = RECORDING_MAX_EVENT_SIZE + 1
                    lazy['_flushBuffer']()

                    expect(shippedSessionIds().size).toEqual(0)
                    expect(lazy['_buffer'].data).toEqual([])
                })

                it('holds idle markers until content arrives, then ships them with it', () => {
                    rotateToASessionWithNoContent()

                    _emit(createCustomSnapshot({ timestamp: Date.now() }, {}, 'sessionIdle'))
                    sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()
                    expect(shippedSessionIds().size).toEqual(0)

                    _emit(createFullSnapshot({ timestamp: Date.now() }))
                    sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                    const shipped = (posthog.capture as Mock).mock.calls.filter(([name]) => name === '$snapshot')
                    expect(shipped).toHaveLength(1)
                    expect((shipped[0][1].$snapshot_data as any[]).map((e) => e.type)).toEqual([
                        EventType.Custom,
                        EventType.FullSnapshot,
                    ])
                })

                it("a session rotation adopted mid-flush does not ship the new epoch's buffer", () => {
                    // Production rrweb delivers addCustomEvent synchronously through emit, which is
                    // what makes rotation adoption re-entrant.
                    _addCustomEvent.mockImplementation((tag: string, payload: any) => {
                        _emit({ type: EventType.Custom, data: { tag, payload }, timestamp: Date.now() })
                    })
                    try {
                        const lazy = sessionRecording['_lazyLoadedSessionRecording']!
                        emitActiveEvent(startingTimestamp + 100)
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                        ;(posthog.capture as Mock).mockClear()

                        const rotateAt = startingTimestamp + sessionManager['_sessionTimeoutMs'] + 1000
                        vi.setSystemTime(new Date(rotateAt))
                        sessionIdGeneratorMock.mockImplementation(() => 'toctou-rotated-session')

                        // The flush consults the session manager after its hold and content checks
                        // (sampling, minimum duration, status). In production that consultation can
                        // adopt a pending rotation and re-enter the recorder; inject the same
                        // re-entry at the same point.
                        const strategy = lazy['_strategy']!
                        const originalEnsure = strategy.ensureSamplingDecision.bind(strategy)
                        vi.spyOn(strategy, 'ensureSamplingDecision').mockImplementation((sid: string) => {
                            sessionManager.checkAndGetSessionAndWindowId(false, rotateAt)
                            return originalEnsure(sid)
                        })

                        lazy['_flushBuffer']()

                        // the re-entrant pass holds the rotation-born epoch; the outer flush, which
                        // validated the old empty buffer, must not ship the rebound one
                        const rotatedShips = (posthog.capture as Mock).mock.calls
                            .filter(([name]) => name === '$snapshot')
                            .filter(([, props]) => props.$session_id === 'toctou-rotated-session')
                        expect(rotatedShips).toEqual([])
                    } finally {
                        _addCustomEvent.mockReset()
                    }
                })

                it('a rotation adopted mid-flush does not get the new buffer cleared or relabeled by the capture path', () => {
                    _addCustomEvent.mockImplementation((tag: string, payload: any) => {
                        _emit({ type: EventType.Custom, data: { tag, payload }, timestamp: Date.now() })
                    })
                    try {
                        const lazy = sessionRecording['_lazyLoadedSessionRecording']!
                        emitActiveEvent(startingTimestamp + 100)
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                        ;(posthog.capture as Mock).mockClear()

                        const rotateAt = startingTimestamp + sessionManager['_sessionTimeoutMs'] + 1000
                        vi.setSystemTime(new Date(rotateAt))
                        sessionIdGeneratorMock.mockImplementation(() => 'toctou-rotated-session')
                        const strategy = lazy['_strategy']!
                        const originalEnsure = strategy.ensureSamplingDecision.bind(strategy)
                        vi.spyOn(strategy, 'ensureSamplingDecision').mockImplementation((sid: string) => {
                            sessionManager.checkAndGetSessionAndWindowId(false, rotateAt)
                            return originalEnsure(sid)
                        })

                        // a lifecycle event targeted at another session forces the capture path to
                        // flush and then rebind the buffer with the event's pre-rotation target ids
                        _emit(
                            createCustomSnapshot(
                                { timestamp: rotateAt },
                                { currentSessionId: 'other-session', currentWindowId: 'other-window' },
                                '$session_ending'
                            )
                        )

                        // the rotation-born epoch keeps its own identity: not relabeled with the
                        // stale target, and nothing shipped under it
                        expect(lazy['_buffer'].sessionId).not.toEqual('other-session')
                        const rotatedShips = (posthog.capture as Mock).mock.calls
                            .filter(([name]) => name === '$snapshot')
                            .filter(([, props]) => props.$session_id === 'toctou-rotated-session')
                        expect(rotatedShips).toEqual([])
                    } finally {
                        _addCustomEvent.mockReset()
                    }
                })

                it('an interaction after many idle rotations ships one session, not the held backlog', () => {
                    runExternalRotations(startingTimestamp, 1)

                    const interactionTimestamp = Date.now() + 1000
                    vi.setSystemTime(new Date(interactionTimestamp))
                    emitActiveEvent(interactionTimestamp)
                    vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

                    const shipped = shippedSessionIds()
                    expect(shipped.size).toEqual(1)
                    expect(shipped).toEqual(new Set([sessionRecording['_lazyLoadedSessionRecording']['_sessionId']]))
                })

                it('a continuously active tab rotates at the 24 hour cap and no shipped session spans longer', () => {
                    const hourInMillis = 60 * 60 * 1000
                    const dayInMillis = 24 * hourInMillis
                    sessionIdGeneratorMock.mockImplementation(() => `volume-active-${uuidv7()}`)

                    // activity every 10 minutes keeps the session inside the 30 minute
                    // activity timeout, so the only legitimate rotation is the 24 hour cap
                    const stepMillis = 10 * 60 * 1000
                    let timestamp = startingTimestamp
                    const endTimestamp = startingTimestamp + 50 * hourInMillis
                    while (timestamp < endTimestamp) {
                        timestamp += stepMillis
                        vi.setSystemTime(new Date(timestamp))
                        emitActiveEvent(timestamp, false)
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                    }

                    const spanBySession = new Map<string, { min: number; max: number }>()
                    for (const [eventName, properties] of (posthog.capture as Mock).mock.calls) {
                        if (eventName !== '$snapshot') continue
                        for (const event of properties.$snapshot_data as eventWithTime[]) {
                            const span = spanBySession.get(properties.$session_id) ?? {
                                min: event.timestamp,
                                max: event.timestamp,
                            }
                            span.min = Math.min(span.min, event.timestamp)
                            span.max = Math.max(span.max, event.timestamp)
                            spanBySession.set(properties.$session_id, span)
                        }
                    }

                    // 50 active hours must rotate at the cap into at least two sessions
                    expect(spanBySession.size).toBeGreaterThanOrEqual(2)
                    for (const [, span] of spanBySession) {
                        expect(span.max - span.min).toBeLessThanOrEqual(dayInMillis)
                    }
                })
            })

            it('takes a full snapshot for the new session on a second idle rotation without user interaction', () => {
                // Regression test for #4202, reported production sequence: interaction, idle,
                // rotation (restart leaves _isIdle 'unknown'), no further interaction, second
                // rotation. The second rotation must also restart the recorder.
                const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as Mock
                const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']

                emitActiveEvent(startingTimestamp + 100)
                emitInactiveEvent(startingTimestamp + RECORDING_IDLE_THRESHOLD_MS + 1000, true)

                sessionIdGeneratorMock.mockClear()
                sessionIdGeneratorMock.mockImplementation(() => 'second-session-id')
                const firstRotationTimestamp = sessionManager['_sessionTimeoutMs'] + startingTimestamp + 1000
                vi.useFakeTimers().setSystemTime(new Date(firstRotationTimestamp))
                sessionManager.checkAndGetSessionAndWindowId(false, firstRotationTimestamp)

                // first rotation while confirmed idle restarts and leaves _isIdle 'unknown'
                expect(lazyRecorder['_sessionId']).toEqual('second-session-id')
                expect(recordMock).toHaveBeenCalledTimes(2)
                expect(lazyRecorder['_isIdle']).toEqual('unknown')

                // the restarted rrweb ships its initial full snapshot; still no user interaction
                _emit(createFullSnapshot({ timestamp: firstRotationTimestamp + 10 }))
                emitInactiveEvent(firstRotationTimestamp + 20, 'unknown')
                expect(lazyRecorder['_buffer'].sessionId).toEqual('second-session-id')

                sessionIdGeneratorMock.mockImplementation(() => 'third-session-id')
                const secondRotationTimestamp = sessionManager['_sessionTimeoutMs'] + firstRotationTimestamp + 1000
                vi.useFakeTimers().setSystemTime(new Date(secondRotationTimestamp))
                const { sessionId: newSessionId } = sessionManager.checkAndGetSessionAndWindowId(
                    false,
                    secondRotationTimestamp
                )
                expect(newSessionId).toEqual('third-session-id')

                // the second rotation must restart the recorder too
                expect(recordMock).toHaveBeenCalledTimes(3)
                expect(lazyRecorder['_sessionId']).toEqual('third-session-id')

                // and the new session's full snapshot is attributed to it
                _emit(createFullSnapshot({ timestamp: secondRotationTimestamp + 10 }))
                expect(lazyRecorder['_buffer'].sessionId).toEqual('third-session-id')
                const fullSnapshotSessions = lazyRecorder['_fullSnapshotTimestamps'].map(
                    ([sid]: [string, number]) => sid
                )
                expect(fullSnapshotSessions).toContain('third-session-id')
            })

            it('restarts only once when the $session_id_change emit drives the restart re-entrantly', () => {
                // Production rrweb delivers addCustomEvent synchronously through emit, so the
                // $session_id_change custom event emitted inside _onSessionIdCallback re-enters
                // _updateWindowAndSessionIds, which adopts the rotated ids and restarts. The
                // callback must then not restart a second time.
                _addCustomEvent.mockImplementation((tag: string, payload: any) => {
                    _emit({ type: EventType.Custom, data: { tag, payload }, timestamp: Date.now() })
                })
                try {
                    const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as Mock
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual('unknown')
                    expect(recordMock).toHaveBeenCalledTimes(1)

                    sessionIdGeneratorMock.mockClear()
                    const rotatedSessionId = 'reentrant-rotated-session-id'
                    sessionIdGeneratorMock.mockImplementation(() => rotatedSessionId)

                    const rotationTimestamp = sessionManager['_sessionTimeoutMs'] + startingTimestamp + 1000
                    vi.useFakeTimers().setSystemTime(new Date(rotationTimestamp))
                    sessionManager.checkAndGetSessionAndWindowId(false, rotationTimestamp)

                    expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionId']).toEqual(rotatedSessionId)
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual('unknown')
                    // exactly one restart: the initial start plus a single re-record for the rotation
                    expect(recordMock).toHaveBeenCalledTimes(2)
                } finally {
                    _addCustomEvent.mockReset()
                }
            })

            it.each([
                ['idle is detected on wake', false],
                ['idle was detected before the tab slept', true],
            ])(
                'attributes the backdated sessionIdle marker to the session that went idle, not a rotation-born session, when %s',
                (_, idleBeforeWake) => {
                    const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as Mock
                    _addCustomEvent.mockImplementation((tag: string, payload: any) => {
                        _emit({ type: EventType.Custom, data: { tag, payload }, timestamp: Date.now() })
                    })
                    // rrweb takes Meta and FullSnapshot synchronously inside record()
                    recordMock.mockImplementation(({ emit }) => {
                        _emit = emit
                        emit(createMetaSnapshot({ timestamp: Date.now() }))
                        emit(createFullSnapshot({ timestamp: Date.now() }))
                        return () => {}
                    })
                    try {
                        const lazy = sessionRecording['_lazyLoadedSessionRecording']!
                        vi.useFakeTimers().setSystemTime(new Date(startingTimestamp + 100))
                        emitActiveEvent(startingTimestamp + 100)
                        _emit(createFullSnapshot({ timestamp: startingTimestamp + 110 }))
                        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
                        if (idleBeforeWake) {
                            const idleTimestamp = startingTimestamp + RECORDING_IDLE_THRESHOLD_MS + 1000
                            vi.setSystemTime(new Date(idleTimestamp))
                            emitInactiveEvent(idleTimestamp, true)
                        }

                        const rotatedSessionId = 'wake-rotated-session-id'
                        sessionIdGeneratorMock.mockImplementation(() => rotatedSessionId)
                        const wakeTimestamp = startingTimestamp + 97 * 60 * 1000
                        vi.setSystemTime(new Date(wakeTimestamp))
                        sessionManager.checkAndGetSessionAndWindowId(false, wakeTimestamp)
                        expect(lazy['_sessionId']).toEqual(rotatedSessionId)

                        expect(posthog.capture).toHaveBeenCalledWith(
                            '$snapshot',
                            expect.objectContaining({
                                $session_id: sessionId,
                                $snapshot_data: expect.arrayContaining([
                                    expect.objectContaining({ data: expect.objectContaining({ tag: 'sessionIdle' }) }),
                                ]),
                            }),
                            expect.any(Object)
                        )

                        const newEpochEvents: any[] = [
                            ...(posthog.capture as Mock).mock.calls
                                .filter(
                                    ([name, props]) => name === '$snapshot' && props.$session_id === rotatedSessionId
                                )
                                .flatMap(([, props]) => props.$snapshot_data),
                            ...lazy['_buffer'].data,
                        ]
                        expect(lazy['_buffer'].sessionId).toEqual(rotatedSessionId)
                        expect(newEpochEvents.map((e) => e.type)).toEqual(
                            expect.arrayContaining([META_EVENT_TYPE, FULL_SNAPSHOT_EVENT_TYPE])
                        )
                        newEpochEvents.forEach((e) => {
                            expect(e.data?.tag).not.toEqual('sessionIdle')
                            expect(e.timestamp).toBeGreaterThanOrEqual(wakeTimestamp)
                        })
                    } finally {
                        _addCustomEvent.mockReset()
                    }
                }
            )

            it('recorder follows an adopted sibling-tab session id (does not record under the stale id)', () => {
                // Regression for cross-tab session adoption: when this tab is idle and a
                // sibling tab has kept the session alive (here under a different id), the
                // idle check ADOPTS the sibling's id instead of rotating. The recorder must
                // switch to the adopted id so its snapshots are stamped with the live
                // session, not this tab's stale one — otherwise the replay splits.
                config.persistence_save_debounce_ms = 250 // enable the cross-tab hardening (emit on adoption)
                try {
                    const firstActivityTimestamp = startingTimestamp + 100
                    const idleTriggerTimestamp = startingTimestamp + RECORDING_IDLE_THRESHOLD_MS + 1000
                    // past this tab's own session timeout, so its first idle check fires
                    const checkTimestamp = sessionManager['_sessionTimeoutMs'] + startingTimestamp + 1000

                    emitActiveEvent(firstActivityTimestamp)
                    const firstSessionId = sessionRecording['_lazyLoadedSessionRecording']['_sessionId']

                    emitInactiveEvent(idleTriggerTimestamp, true)
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_isIdle']).toEqual(true)

                    const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as Mock
                    recordMock.mockClear()

                    // A sibling tab kept the session alive under its own id. The cross-tab
                    // refresh pulls that id (with fresh activity) from storage, so the idle
                    // check adopts it rather than rotating. We must NOT rotate, so the
                    // generator returning a fresh id would be a bug — assert against it.
                    const siblingSessionId = 'sibling-tab-session-id'
                    sessionIdGeneratorMock.mockClear()
                    sessionIdGeneratorMock.mockImplementation(() => 'should-not-be-generated')
                    const persistence = sessionManager['_persistence']
                    const refreshSpy = vi.spyOn(persistence, 'refreshKey').mockImplementation(() => {
                        persistence.props[SESSION_ID] = [checkTimestamp - 1000, siblingSessionId, startingTimestamp]
                    })

                    // An analytics event triggers checkAndGetSessionAndWindowId while idle.
                    vi.useFakeTimers().setSystemTime(new Date(checkTimestamp))
                    const { sessionId: resultSessionId } = sessionManager.checkAndGetSessionAndWindowId(
                        false,
                        checkTimestamp
                    )

                    // The manager adopted the sibling's id, it did not rotate.
                    expect(resultSessionId).toEqual(siblingSessionId)
                    expect(resultSessionId).not.toEqual(firstSessionId)
                    expect(sessionIdGeneratorMock).not.toHaveBeenCalled()

                    // The recorder followed the adopted id (emit fired synchronously while
                    // idle), and restarted exactly once — no churn.
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionId']).toEqual(siblingSessionId)
                    expect(recordMock).toHaveBeenCalledTimes(1)

                    refreshSpy.mockRestore()
                } finally {
                    delete config.persistence_save_debounce_ms
                }
            })

            // Verifies the suspected teardown-race between stop()'s async compression-queue
            // drain and the synchronous start('session_id_changed') that follows. If the
            // pending cleanup proceeds (its generation check passes because nothing bumped
            // it during start()), it calls _teardown() on the recorder — silently undoing
            // the restart. The recorder then appears to be in an ACTIVE strategy state but
            // rrweb is dead, no listeners are attached, and snapshots never reach the server.
            it('keeps the new recorder alive when stop() had an in-flight compression queue', async () => {
                const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as Mock
                const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']

                // Establish a recording session and pretend the compression queue is non-empty.
                emitActiveEvent(startingTimestamp + 100)
                expect(recordMock).toHaveBeenCalledTimes(1)
                expect(lazyRecorder['isStarted']).toEqual(true)

                lazyRecorder['_queuedCompressionEvents'] = 1
                let resolveDrain: () => void = () => {}
                lazyRecorder['_compressionQueue'] = new Promise<void>((resolve) => {
                    resolveDrain = resolve
                })

                // Rotate the session — _updateWindowAndSessionIds runs stop()+start().
                // stop() takes the _stopAfterCompressionQueueDrains path because the queue
                // is non-empty, queueing async cleanup. start() then synchronously restarts
                // the recorder.
                sessionIdGeneratorMock.mockClear()
                sessionIdGeneratorMock.mockImplementation(() => 'rotated-session-id')
                const rotationTimestamp = startingTimestamp + 100 + sessionManager['_sessionTimeoutMs'] + 1000
                vi.useFakeTimers().setSystemTime(new Date(rotationTimestamp))
                emitActiveEvent(rotationTimestamp)

                expect(recordMock).toHaveBeenCalledTimes(2)
                expect(lazyRecorder['isStarted']).toEqual(true)
                expect(lazyRecorder['_sessionId']).toEqual('rotated-session-id')

                // Resolve the queued drain — this fires the async cleanup from the prior
                // stop(). With the bug, the cleanup calls _teardown() on the new recorder.
                resolveDrain()
                await Promise.resolve()
                await Promise.resolve()

                // The new recorder must still be alive. If the teardown race fired, isStarted
                // would be false (rrweb stopped) and the V2 strategy would have its matchers
                // cleared so status returns 'disabled'.
                expect(lazyRecorder['isStarted']).toEqual(true)
                expect(['active', 'sampled', 'buffering']).toContain(sessionRecording.status)
            })

            it('completes the rotation restart when capturing a queued compression event throws', () => {
                const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']
                const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as Mock

                emitActiveEvent(startingTimestamp + 100)
                lazyRecorder['_pendingCompressionEvents'].push({
                    event: createIncrementalSnapshot({ timestamp: startingTimestamp + 200 }),
                    compressionEnabled: false,
                    targetSessionId: lazyRecorder['_sessionId'],
                    targetWindowId: lazyRecorder['_windowId'],
                    generation: lazyRecorder['_compressionQueueGeneration'],
                    processed: false,
                    counted: true,
                })
                lazyRecorder['_queuedCompressionEvents'] = 1
                lazyRecorder['_compressionQueue'] = Promise.resolve()
                const captureSpy = vi
                    .spyOn(lazyRecorder as any, '_captureQueuedCompressionEvent')
                    .mockImplementationOnce(() => {
                        throw new Error('capture failed')
                    })

                sessionIdGeneratorMock.mockImplementation(() => 'rotated-session-id')
                const rotationTimestamp = startingTimestamp + 100 + sessionManager['_sessionTimeoutMs'] + 1000
                vi.useFakeTimers().setSystemTime(new Date(rotationTimestamp))
                emitActiveEvent(rotationTimestamp)

                expect(captureSpy).toHaveBeenCalledTimes(1)
                expect(recordMock).toHaveBeenCalledTimes(2)
                expect(lazyRecorder['isStarted']).toEqual(true)
                expect(lazyRecorder['_sessionId']).toEqual('rotated-session-id')
                expect(lazyRecorder['_isRestartingForSessionIdChange']).toEqual(false)
                expect(lazyRecorder['_queuedCompressionEvents']).toEqual(0)
                expect(lazyRecorder['_pendingCompressionEvents']).toEqual([])
            })

            // The rotation must not leave behind stale stop-in-progress state. If start()
            // only invalidated the generation, _isStoppingAfterCompression would stay true
            // (the bailed-out drain never resets it) and _queuedCompressionEvents would stay
            // counted (stale-generation events never decrement it) — so every later stop()
            // would hit the in-progress guard in _stopAfterCompressionQueueDrains and
            // silently no-op, leaving rrweb running forever.
            it('can still stop the new recorder after surviving an in-flight compression queue', async () => {
                const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']

                emitActiveEvent(startingTimestamp + 100)
                expect(lazyRecorder['isStarted']).toEqual(true)

                lazyRecorder['_queuedCompressionEvents'] = 1
                let resolveDrain: () => void = () => {}
                lazyRecorder['_compressionQueue'] = new Promise<void>((resolve) => {
                    resolveDrain = resolve
                })

                sessionIdGeneratorMock.mockClear()
                sessionIdGeneratorMock.mockImplementation(() => 'rotated-session-id')
                const rotationTimestamp = startingTimestamp + 100 + sessionManager['_sessionTimeoutMs'] + 1000
                vi.useFakeTimers().setSystemTime(new Date(rotationTimestamp))
                emitActiveEvent(rotationTimestamp)

                resolveDrain()
                await Promise.resolve()
                await Promise.resolve()
                expect(lazyRecorder['isStarted']).toEqual(true)

                lazyRecorder.stop()

                expect(lazyRecorder['isStarted']).toEqual(false)
            })

            // #3822: stopSessionRecording() → reset() → identify() → startSessionRecording()
            // leaked the prior session's buffer (flushed under the old session id), mis-attributing
            // the recording. start() must discard it when bailing out the pending stop.
            it('discards the prior session buffer when start() bails out a pending stop()', () => {
                const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']

                // Establish a recording session with the prior user's data sitting in the buffer.
                emitActiveEvent(startingTimestamp + 100)
                const priorSessionId = lazyRecorder['_sessionId']
                expect(lazyRecorder['_buffer'].data.length).toBeGreaterThan(0)
                expect(lazyRecorder['_buffer'].sessionId).toEqual(priorSessionId)

                // stopSessionRecording() via the async compression-drain path: rrweb stops, but the
                // buffer flush and teardown are deferred until the queue drains.
                lazyRecorder['_isStoppingAfterCompression'] = true
                lazyRecorder['_queuedCompressionEvents'] = 1
                lazyRecorder['_compressionQueue'] = new Promise<void>(() => {})
                lazyRecorder['_stopRecordingProducers']()
                expect(lazyRecorder['isStarted']).toEqual(false)

                // reset() clears the session id; the fresh id then makes start()'s
                // checkAndGetSessionAndWindowId() fire the onSessionId restart synchronously.
                sessionManager.resetSessionId()
                ;(posthog.capture as Mock).mockClear()
                sessionIdGeneratorMock.mockClear()
                sessionIdGeneratorMock.mockImplementation(() => 'post-reset-session-id')

                lazyRecorder.start()

                // No snapshot from the prior session may be flushed during the restart.
                const leakedPriorSessionSnapshot = (posthog.capture as Mock).mock.calls.find(
                    (call) => call[0] === '$snapshot' && call[1]?.$session_id === priorSessionId
                )
                expect(leakedPriorSessionSnapshot).toBeUndefined()
                expect(lazyRecorder['isStarted']).toEqual(true)
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
                    // the incremental arriving before the rotated session's full snapshot triggers a healing snapshot
                    ['rotated-session-id', undefined],
                    ['rotated-session-id', 3000],
                ])
            })
        })

        describe('rotation after persistence is cleared (posthog.reset)', () => {
            beforeEach(() => {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
            })

            it('restarts rrweb on the rotation that follows posthog.reset() when remote config is preserved', () => {
                // Sanity: the recorder started on remote-config arrival.
                const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as Mock
                expect(recordMock).toHaveBeenCalledTimes(1)

                // Simulate posthog.reset() with the fix in place: snapshot the
                // recording remote config, clear all persistence, then re-register
                // the snapshotted config. This is exactly what posthog-core.ts does.
                const preservedConfig = posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG)
                expect(preservedConfig).toBeDefined()
                posthog.persistence?.clear()
                posthog.persistence?.register({ [SESSION_RECORDING_REMOTE_CONFIG]: preservedConfig })

                // resetSessionId() forces a new session id on the next
                // checkAndGetSessionAndWindowId() call.
                sessionManager.resetSessionId()
                sessionId = 'rotated-session-id'

                // An interactive event drives _updateWindowAndSessionIds, which
                // detects the rotation and calls stop() then start('session_id_changed').
                _emit(createIncrementalSnapshot({ data: { source: IncrementalSource.MouseInteraction } }))

                // start('session_id_changed') was able to read remote config and
                // restart rrweb — confirmed by a second record() call.
                expect(recordMock).toHaveBeenCalledTimes(2)
            })

            it('attributes the rotated session full snapshot to the new session id', () => {
                const firstSessionId = sessionId
                releaseInteractionHold()
                _emit(createFullSnapshot({ timestamp: 1000 }))
                _emit(createIncrementalSnapshot({ data: { source: IncrementalSource.MouseInteraction } }))

                const preservedConfig = posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG)
                posthog.persistence?.clear()
                posthog.persistence?.register({ [SESSION_RECORDING_REMOTE_CONFIG]: preservedConfig })
                sessionManager.resetSessionId()
                sessionId = 'rotated-session-id'
                ;(posthog.capture as Mock).mockClear()

                sessionManager.checkAndGetSessionAndWindowId()
                releaseInteractionHold()

                _emit(createMetaSnapshot({ timestamp: 2000 }))
                _emit(createFullSnapshot({ timestamp: 2001 }))
                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                const rotatedEpochAttribution = (posthog.capture as Mock).mock.calls
                    .filter(([event]) => event === '$snapshot')
                    .flatMap(([, properties]) =>
                        properties.$snapshot_data
                            .filter((e: any) => e.timestamp >= 2000)
                            .map((e: any) => [e.type, properties.$session_id])
                    )

                expect(rotatedEpochAttribution).toEqual([
                    [META_EVENT_TYPE, 'rotated-session-id'],
                    [FULL_SNAPSHOT_EVENT_TYPE, 'rotated-session-id'],
                ])
                expect(firstSessionId).not.toBe('rotated-session-id')
            })

            it('restarts rrweb on the reset rotation even when the preserved remote config is past its TTL', () => {
                const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as Mock
                const firstSessionId = sessionId
                releaseInteractionHold()
                _emit(createFullSnapshot({ timestamp: 1000 }))

                const preservedConfig = posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG) as any
                posthog.persistence?.clear()
                posthog.persistence?.register({
                    [SESSION_RECORDING_REMOTE_CONFIG]: {
                        ...preservedConfig,
                        cache_timestamp: Date.now() - RECORDING_REMOTE_CONFIG_TTL_MS - 1,
                    },
                })
                sessionManager.resetSessionId()
                sessionId = 'rotated-session-id'
                ;(posthog.capture as Mock).mockClear()

                sessionManager.checkAndGetSessionAndWindowId()

                expect({
                    recordCalls: recordMock.mock.calls.length,
                    isStarted: sessionRecording['_lazyLoadedSessionRecording'].isStarted,
                    attributedTo:
                        sessionRecording['_lazyLoadedSessionRecording']['_sessionId'] === firstSessionId
                            ? 'stale first session'
                            : sessionRecording['_lazyLoadedSessionRecording']['_sessionId'],
                }).toEqual({ recordCalls: 2, isStarted: true, attributedTo: 'rotated-session-id' })

                expect(sessionRecording['_lazyLoadedSessionRecording']['_isRestartingForSessionIdChange']).toBe(false)
                const refreshedConfig = posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG) as any
                expect(refreshedConfig.cache_timestamp).toBeGreaterThan(Date.now() - RECORDING_REMOTE_CONFIG_TTL_MS)
            })

            describe('with rrweb-faithful custom events and snapshots', () => {
                let recordMock: Mock
                beforeEach(() => {
                    recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as Mock
                    // real rrweb delivers addCustomEvent back through emit
                    assignableWindow.__PosthogExtensions__.rrweb.record.addCustomEvent = vi.fn(
                        (tag: string, payload: any) => {
                            _emit({ type: EventType.Custom, data: { tag, payload }, timestamp: Date.now() })
                        }
                    )
                    // real rrweb emits Meta + FullSnapshot synchronously when record() starts
                    recordMock.mockImplementation(({ emit }: any) => {
                        _emit = emit
                        emit(createMetaSnapshot({ timestamp: Date.now() }))
                        emit(createFullSnapshot({ timestamp: Date.now() }))
                        return () => {}
                    })
                })

                it('attributes the restart snapshot and $session_id_change to the new session on reset while active', () => {
                    const firstSessionId = sessionId
                    releaseInteractionHold()
                    _emit(createFullSnapshot({ timestamp: 1000 }))
                    _emit(createIncrementalSnapshot({ data: { source: IncrementalSource.MouseInteraction } }))

                    const preservedConfig = posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG)
                    posthog.persistence?.clear()
                    posthog.persistence?.register({ [SESSION_RECORDING_REMOTE_CONFIG]: preservedConfig })
                    sessionManager.resetSessionId()
                    sessionId = 'rotated-session-id'
                    ;(posthog.capture as Mock).mockClear()

                    // identify() after reset() runs the session check while recording is active
                    sessionManager.checkAndGetSessionAndWindowId()

                    releaseInteractionHold()
                    sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                    const snapshotCalls = (posthog.capture as Mock).mock.calls.filter(([name]) => name === '$snapshot')
                    const attributionFor = (predicate: (e: any) => boolean): string[] =>
                        snapshotCalls.flatMap(([, props]) =>
                            props.$snapshot_data.filter(predicate).map(() => props.$session_id)
                        )

                    expect(recordMock.mock.calls.length).toBe(2)
                    expect(attributionFor((e) => e.data?.tag === '$session_id_change')).toEqual(['rotated-session-id'])
                    expect(attributionFor((e) => e.type === FULL_SNAPSHOT_EVENT_TYPE && e.timestamp !== 1000)).toEqual([
                        'rotated-session-id',
                    ])
                    expect(firstSessionId).not.toBe('rotated-session-id')
                })
            })
        })

        describe('when compression is active', () => {
            const captureOptions = {
                _batchKey: 'recordings',
                _noTruncate: true,
                _url: 'https://test.com/s/',
                skip_client_rate_limiting: true,
            }

            beforeEach(async () => {
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
                await sessionRecording['_lazyLoadedSessionRecording']['_compressionQueue']
                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()
            })

            it('compresses full snapshot data', async () => {
                _emit(
                    createFullSnapshot({
                        data: {
                            content: Array(30).fill(uuidv7()).join(''),
                        },
                    })
                )
                await sessionRecording['_lazyLoadedSessionRecording']['_compressionQueue']
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
                        $snapshot_host: 'localhost',
                    },
                    captureOptions
                )
            })

            it.each([
                [
                    'a direct self-reference',
                    (data: Record<string, any>) => {
                        data.circularReference = data
                    },
                ],
                [
                    'a cycle through an array',
                    (data: Record<string, any>) => {
                        // shape seen in production: object -> array -> element -> back to the root
                        data.plugins = [{ instance: data }]
                    },
                ],
            ])('compresses full snapshot data containing %s without throwing', async (_name, addCycle) => {
                const data: Record<string, any> = { content: Array(30).fill(uuidv7()).join('') }
                addCycle(data)

                expect(() => _emit(createFullSnapshot({ data }))).not.toThrow()
                await sessionRecording['_lazyLoadedSessionRecording']['_compressionQueue']
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
                        $snapshot_host: 'localhost',
                    },
                    captureOptions
                )
            })

            it('compresses incremental snapshot mutation data', async () => {
                _emit(createIncrementalMutationEvent({ texts: [Array(30).fill(uuidv7()).join('')] }))
                await sessionRecording['_lazyLoadedSessionRecording']['_compressionQueue']
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
                        $snapshot_host: 'localhost',
                    },
                    captureOptions
                )
            })

            it('compresses incremental snapshot style data', async () => {
                _emit(createIncrementalStyleSheetEvent({ adds: [Array(30).fill(uuidv7()).join('')] }))
                await sessionRecording['_lazyLoadedSessionRecording']['_compressionQueue']
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
                        $snapshot_host: 'localhost',
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
                        $snapshot_host: 'localhost',
                    },
                    captureOptions
                )
            })

            it('does not compress custom events', async () => {
                _emit(createFullSnapshot())
                await sessionRecording['_lazyLoadedSessionRecording']['_compressionQueue']
                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()
                ;(posthog.capture as Mock).mockClear()
                _emit(createCustomSnapshot(undefined, { tag: 'wat' }))
                await sessionRecording['_lazyLoadedSessionRecording']['_compressionQueue']
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
                        $snapshot_host: 'localhost',
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
                        $snapshot_host: 'localhost',
                    },
                    captureOptions
                )
            })
        })
    })

    describe('recording', () => {
        it('still starts when the bundled core has no SessionIdManager.on (version skew with CDN recorder)', () => {
            // The recorder chunk is loaded from the CDN and can run against an older bundled core.
            // SessionIdManager.on was only added in posthog-js 1.268.6, so simulate an older core that
            // lacks it and assert start() degrades gracefully instead of throwing a TypeError.
            // @ts-expect-error deliberately removing the method to emulate an older core (it lives on
            // the prototype, so overriding the instance property is how we make it "not a function")
            sessionManager.on = undefined

            expect(() =>
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
            ).not.toThrow()

            // recording still starts, it just skips the forced-idle-reset listener
            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['isStarted']).toEqual(true)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_onSessionIdleResetForcedListener']).toBeUndefined()
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
                sizes: [30],
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
                    $snapshot_host: 'localhost',
                },
                {
                    _url: 'https://test.com/s/',
                    _noTruncate: true,
                    _batchKey: 'recordings',
                    skip_client_rate_limiting: true,
                }
            )
            const captureArguments = posthog.capture.mock.calls[0]
            expect(captureArguments[1].$session_id).toBe(sessionId)
            expect([
                captureArguments[0],
                { ...captureArguments[1], $session_id: '<generated-session-id>' },
                captureArguments[2],
            ]).toMatchSnapshot()
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
                    $snapshot_host: 'localhost',
                },
                {
                    _url: 'https://test.com/s/',
                    _noTruncate: true,
                    _batchKey: 'recordings',
                    skip_client_rate_limiting: true,
                }
            )
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
                    $snapshot_host: 'localhost',
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
                sizes: [39],
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
                            register: vi.fn(),
                        })
                    )
                    posthog.sessionManager = sessionManager

                    mockCallback = vi.fn()
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
                    vi.useRealTimers()
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
                    vi.useFakeTimers().setSystemTime(inactivityThresholdLater)
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
                            register: vi.fn(),
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

                    sessionRecording['_lazyLoadedSessionRecording'].stop = vi.fn()
                    sessionRecording['_lazyLoadedSessionRecording'].start = vi.fn()

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

                    sessionRecording['_lazyLoadedSessionRecording'].stop = vi.fn()
                    sessionRecording['_lazyLoadedSessionRecording'].start = vi.fn()

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

    describe('Event triggering', () => {
        it('reports the same pending condition again after session rotation', () => {
            const previousDebug = assignableWindow.POSTHOG_DEBUG
            assignableWindow.POSTHOG_DEBUG = true
            const logSpy = vi.spyOn(window!.console, 'log').mockImplementation(() => {})

            try {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                            urlTriggers: [{ url: 'start-on-me', matching: 'regex' }],
                        },
                    })
                )
                releaseInteractionHold()
                const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']

                lazyRecorder['_flushBuffer']()
                sessionIdGeneratorMock.mockImplementation(() => 'rotated-session-id')
                sessionManager.resetSessionId()
                sessionManager.checkAndGetSessionAndWindowId()
                expect(lazyRecorder.sessionId).toBe('rotated-session-id')
                lazyRecorder['_clearBuffer']()
                releaseInteractionHold()
                lazyRecorder['_flushBuffer']()

                expect(
                    logSpy.mock.calls
                        .filter((call) => typeof call[1] === 'string' && call[1].startsWith('buffering:'))
                        .map((call) => call[1])
                ).toEqual(['buffering: URL condition not matched', 'buffering: URL condition not matched'])
            } finally {
                logSpy.mockRestore()
                assignableWindow.POSTHOG_DEBUG = previousDebug
            }
        })
    })

    describe('startIfEnabledOrStop', () => {
        beforeEach(() => {
            // need to cast as any to mock private methods
            vi.spyOn(sessionRecording as any, '_lazyLoadAndStart')
            vi.spyOn(sessionRecording, 'stopRecording')
            vi.spyOn(sessionRecording, 'tryAddCustomEvent')
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

        it('retains visibility history while the lazy recorder is stopped', () => {
            sessionRecording.dispose()
            const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
            const visibilityHistory = mockVisibilityHistory('hidden')
            try {
                posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
                sessionRecording = new SessionRecording(posthog)
                sessionRecording.setup(posthog._getBrowserClientAdapter())
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                sessionRecording.stopRecording()

                visibilityState.mockReturnValue('visible')
                document.dispatchEvent(new Event('visibilitychange'))
                visibilityState.mockReturnValue('hidden')
                document.dispatchEvent(new Event('visibilitychange'))

                sessionRecording.startIfEnabledOrStop()
                sessionRecording.onRRwebEmit(createFullSnapshot({ timestamp: Date.now() }))
                const snapshot = createCustomSnapshot({ timestamp: Date.now() })
                sessionRecording.onRRwebEmit(snapshot)
                ;(posthog.capture as Mock).mockClear()
                sessionRecording['_lazyLoadedSessionRecording']['_onBeforeUnload']()

                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    expect.objectContaining({ $snapshot_data: expect.arrayContaining([snapshot]) }),
                    expect.any(Object)
                )
            } finally {
                sessionRecording.dispose()
                visibilityHistory.mockRestore()
                visibilityState.mockRestore()
            }
        })

        it('does not start a recorder when its script loads after disposal', () => {
            let completeScriptLoad: (() => void) | undefined
            loadScriptMock.mockImplementation((_ph, _path, callback) => {
                completeScriptLoad = () => {
                    addRRwebToWindow()
                    callback()
                }
            })
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']).toBeUndefined()

            sessionRecording.dispose()
            completeScriptLoad!()

            expect(sessionRecording['_lazyLoadedSessionRecording']).toBeUndefined()
        })

        it('does not throw on rrweb emit after sessionManager is gone (regression for #58017)', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            // simulate sessionManager teardown (cookieless opt-out) before a late rrweb event
            ;(posthog as any).sessionManager = undefined
            ;(posthog.capture as vi.Mock).mockClear()

            expect(() =>
                sessionRecording.onRRwebEmit(createIncrementalSnapshot({ data: { source: 1 } }) as eventWithTime)
            ).not.toThrow()
            expect(posthog.capture).not.toHaveBeenCalled()
        })
    })

    describe('sampling', () => {
        it('does not expose the sampling override null sentinel on event properties', () => {
            posthog.persistence?.register({
                [SESSION_RECORDING_OVERRIDE_SAMPLING]: true,
            })

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.00' },
                })
            )

            expect(posthog.get_property(SESSION_RECORDING_SAMPLE_RATE)).toBeNull()
            expect(posthog.persistence?.properties()).not.toHaveProperty(SESSION_RECORDING_SAMPLE_RATE)

            posthog.persistence?.register({
                [SESSION_RECORDING_SAMPLE_RATE]: 0,
            })
            expect(posthog.persistence?.properties()[SESSION_RECORDING_SAMPLE_RATE]).toBe(0)
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

        describe('missing sampling decision (posthog.reset())', () => {
            // simpleHash('session-a') % 100 === 46 → sampled in at 50%
            // simpleHash('session-e') % 100 === 50 → sampled out at 50%
            const SAMPLED_IN_SESSION_ID = 'session-a'
            const SAMPLED_OUT_SESSION_ID = 'session-e'

            it('re-makes the decision before flushing when the stored decision was wiped', () => {
                sessionId = SAMPLED_IN_SESSION_ID
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({ sessionRecording: { endpoint: '/s/', sampleRate: '0.50' } })
                )
                expect(sessionRecording.status).toBe('sampled')

                _emit(createIncrementalSnapshot({ data: { source: 1 } }))

                // posthog.reset() clears persistence (including the stored decision)
                // while rrweb keeps emitting
                posthog.persistence?.unregister(SESSION_RECORDING_IS_SAMPLED)

                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                // the decision was re-made (deterministically, same outcome) before sending
                expect(posthog.get_property(SESSION_RECORDING_IS_SAMPLED)).toBe(SAMPLED_IN_SESSION_ID)
                expect(posthog.capture).toHaveBeenCalledWith(
                    '$snapshot',
                    expect.objectContaining({ $session_id: SAMPLED_IN_SESSION_ID }),
                    expect.anything()
                )
            })

            it('does not leak snapshots into a new session that is sampled out', () => {
                sessionId = SAMPLED_IN_SESSION_ID
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({ sessionRecording: { endpoint: '/s/', sampleRate: '0.50' } })
                )
                expect(sessionRecording.status).toBe('sampled')

                _emit(createIncrementalSnapshot({ data: { source: 1 } }))

                // posthog.reset() wipes the stored decision and the persisted remote
                // config is unavailable at session-change time, then rotates the session
                posthog.persistence?.unregister(SESSION_RECORDING_IS_SAMPLED)
                posthog.persistence?.unregister(SESSION_RECORDING_REMOTE_CONFIG)
                sessionManager.resetSessionId()
                sessionId = SAMPLED_OUT_SESSION_ID
                ;(posthog.capture as Mock).mockClear()

                _emit(createIncrementalSnapshot({ data: { source: 1 } }))

                // the new session must have a (negative) decision, not record unsampled
                expect(sessionRecording.status).toBe('disabled')
                expect(posthog.get_property(SESSION_RECORDING_IS_SAMPLED)).toBe('!' + SAMPLED_OUT_SESSION_ID)

                // and nothing is ever sent for the sampled-out session
                expect(posthog.capture).not.toHaveBeenCalledWith(
                    '$snapshot',
                    expect.objectContaining({ $session_id: SAMPLED_OUT_SESSION_ID }),
                    expect.anything()
                )
            })
        })
    })

    describe('parking a held buffer across a page unload', () => {
        const parkedBufferKey = 'ph' + PENDING_BUFFER_STORAGE_SUFFIX + '_["test-token","test-token"]'
        const parkedBuffer = () => JSON.parse(window!.sessionStorage.getItem(parkedBufferKey) || 'null')

        // the shared harness leaves recorders from earlier tests listening on the window, so drive
        // the handler directly rather than dispatching a real unload event
        const unload = () => sessionRecording['_lazyLoadedSessionRecording']['_onBeforeUnload']()

        beforeEach(() => {
            // a frozen clock keeps the session from ageing out between the emit and the flush
            vi.useFakeTimers()
            vi.setSystemTime(new Date())
            // the shared harness uses memory persistence, which opts out of every browser store
            config.persistence = 'localStorage'
            window!.sessionStorage.clear()
            resetSessionStorageSupported()
        })

        afterEach(() => {
            window!.sessionStorage.clear()
        })

        const startBelowMinimumDuration = (): number => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )
            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 100 }))
            return sessionStartTimestamp
        }

        it('parks the buffer the minimum-duration gate is holding, instead of losing it with the page', () => {
            startBelowMinimumDuration()

            unload()

            expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
            expect(parkedBuffer().data).toHaveLength(1)
            expect(parkedBuffer().sessionId).toBe(sessionId)
        })

        it('parks a sampled-in buffer the minimum-duration gate is holding', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500, sampleRate: '1.00' },
                })
            )
            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 100 }))

            // guard against a vacuous pass: a sampled-in session reports SAMPLED, not ACTIVE, and the
            // minimum-duration gate must park it the same way
            expect(sessionRecording.status).toBe('sampled')

            unload()

            expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
            expect(parkedBuffer().data).toHaveLength(1)
            expect(parkedBuffer().sessionId).toBe(sessionId)
        })

        it('parks markers that would otherwise open a recording with nothing to play', () => {
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            releaseInteractionHold()
            _emit(createCustomSnapshot({ timestamp: Date.now() }, {}, 'sessionIdle'))

            unload()

            expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
            expect(parkedBuffer().data).toHaveLength(1)
        })

        it('ships the parked buffer from the next page in the tab', () => {
            const sessionStartTimestamp = startBelowMinimumDuration()
            unload()
            sessionRecording.stopRecording()
            ;(posthog.capture as Mock).mockClear()

            // the next page load in the same tab, so the same session and the same window
            posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
            sessionRecording = new SessionRecording(posthog)
            sessionRecording.setup(posthog._getBrowserClientAdapter())
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )
            expect(parkedBuffer()).toBeNull()

            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 2000 }))
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            const shipped = (posthog.capture as Mock).mock.calls.filter(([name]) => name === '$snapshot')
            expect(shipped).toHaveLength(1)
            const timestamps = (shipped[0][1].$snapshot_data as any[]).map((e) => e.timestamp)
            expect(timestamps).toContain(sessionStartTimestamp + 100)
            expect(timestamps).toContain(sessionStartTimestamp + 2000)
        })

        it.each(['_flushBuffer', '_onPageHide'] as const)(
            'does not restore snapshots already shipped by %s after parking',
            (flushMethod) => {
                const sessionStartTimestamp = startBelowMinimumDuration()
                unload()
                expect(parkedBuffer().data).toHaveLength(1)

                // beforeunload can be cancelled, or pagehide can flush later events past the gate.
                _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 2000 }))
                sessionRecording['_lazyLoadedSessionRecording'][flushMethod]()

                const firstPageSnapshots = (posthog.capture as Mock).mock.calls.filter(([name]) => name === '$snapshot')
                expect(firstPageSnapshots).toHaveLength(1)
                expect(
                    firstPageSnapshots[0][1].$snapshot_data.map((event: eventWithTime) => event.timestamp)
                ).toContain(sessionStartTimestamp + 100)

                unload()
                sessionRecording.stopRecording()
                ;(posthog.capture as Mock).mockClear()
                posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
                sessionRecording = new SessionRecording(posthog)
                sessionRecording.setup(posthog._getBrowserClientAdapter())
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: { minimumDurationMilliseconds: 1500 },
                    })
                )
                _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 3000 }))
                sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

                const nextPageSnapshots = (posthog.capture as Mock).mock.calls.filter(([name]) => name === '$snapshot')
                expect(nextPageSnapshots).toHaveLength(1)
                expect(
                    nextPageSnapshots[0][1].$snapshot_data.map((event: eventWithTime) => event.timestamp)
                ).not.toContain(sessionStartTimestamp + 100)
            }
        )

        it('keeps the parked buffer while a later flush is still held', () => {
            startBelowMinimumDuration()
            unload()
            const parked = parkedBuffer()

            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(parkedBuffer()).toEqual(parked)
            expect(posthog.capture).not.toHaveBeenCalledWith('$snapshot', expect.anything(), expect.anything())
        })

        it('does not restore a buffer parked by another session', () => {
            startBelowMinimumDuration()
            unload()
            sessionRecording.stopRecording()

            window!.sessionStorage.setItem(
                parkedBufferKey,
                JSON.stringify({ ...parkedBuffer(), sessionId: 'some-other-session' })
            )

            posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
            sessionRecording = new SessionRecording(posthog)
            sessionRecording.setup(posthog._getBrowserClientAdapter())
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(0)
        })

        it.each(['test-token', 'another-token'])(
            'isolates a shared persistence name when the next page uses %s',
            (nextToken) => {
                config.persistence_name = 'shared'
                const sessionStartTimestamp = startBelowMinimumDuration()
                const previousRecorder = sessionRecording['_lazyLoadedSessionRecording']
                unload()
                expect(
                    window!.sessionStorage.getItem(
                        'ph' +
                            PENDING_BUFFER_STORAGE_SUFFIX +
                            '_' +
                            JSON.stringify([config.persistence_name || config.token, config.token])
                    )
                ).not.toBeNull()
                sessionRecording.stopRecording()
                ;(posthog.capture as Mock).mockClear()

                config.token = nextToken
                posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
                sessionRecording = new SessionRecording(posthog)
                sessionRecording.setup(posthog._getBrowserClientAdapter())
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({ sessionRecording: { minimumDurationMilliseconds: 1500 } })
                )
                const nextRecorder = sessionRecording['_lazyLoadedSessionRecording']
                // Shared persistence also shares these IDs; they cannot isolate projects on their own.
                expect(nextRecorder.sessionId).toBe(previousRecorder.sessionId)
                expect(nextRecorder['_windowId']).toBe(previousRecorder['_windowId'])
                _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 2000 }))
                nextRecorder['_flushBuffer']()

                const shipped = (posthog.capture as Mock).mock.calls.filter(([name]) => name === '$snapshot')
                expect(shipped).toHaveLength(1)
                const timestamps = shipped[0][1].$snapshot_data.map((event: eventWithTime) => event.timestamp)
                expect(timestamps.includes(sessionStartTimestamp + 100)).toBe(nextToken === 'test-token')
                expect(timestamps).toContain(sessionStartTimestamp + 2000)
            }
        )

        it('does not restore legacy parked data whose project token is unknown', () => {
            const sessionStartTimestamp = startBelowMinimumDuration()
            unload()
            const key =
                'ph' +
                PENDING_BUFFER_STORAGE_SUFFIX +
                '_' +
                JSON.stringify([config.persistence_name || config.token, config.token])
            const parked = window!.sessionStorage.getItem(key)!
            sessionRecording.stopRecording()
            window!.sessionStorage.clear()
            window!.sessionStorage.setItem('ph_test-token' + PENDING_BUFFER_STORAGE_SUFFIX, parked)
            ;(posthog.capture as Mock).mockClear()

            posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter
            sessionRecording = new SessionRecording(posthog)
            sessionRecording.setup(posthog._getBrowserClientAdapter())
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({ sessionRecording: { minimumDurationMilliseconds: 1500 } })
            )
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 2000 }))
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            const shipped = (posthog.capture as Mock).mock.calls.filter(([name]) => name === '$snapshot')
            expect(shipped).toHaveLength(1)
            expect(shipped[0][1].$snapshot_data.map((event: eventWithTime) => event.timestamp)).not.toContain(
                sessionStartTimestamp + 100
            )
        })

        it('does not park a buffer a flush holds while the page stays open', () => {
            startBelowMinimumDuration()

            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(parkedBuffer()).toBeNull()
        })

        it('does not park while recording is paused', () => {
            startBelowMinimumDuration()
            sessionRecording['_lazyLoadedSessionRecording']['_pauseRecording']()

            unload()

            expect(parkedBuffer()).toBeNull()
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
            vi.spyOn(sessionRecording['_lazyLoadedSessionRecording'], '_tryAddCustomEvent')
        })

        it('emits session linking events on activity timeout', () => {
            const tryAddCustomEvent = sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent'] as any
            // confirm user activity so the rotation callback defers the restart to
            // _updateWindowAndSessionIds and only the linking events are captured below
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: Date.now() }))
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
            // confirm user activity so the rotation callback defers the restart to
            // _updateWindowAndSessionIds and only the linking events are captured below
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: Date.now() }))
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
                sessionRecording['_lazyLoadedSessionRecording']['_flushedSizeTracker'].currentTrackedSize(sessionId)
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

            // the new session starts from zero without leaking the previous session's total
            expect(
                sessionRecording['_lazyLoadedSessionRecording']['_flushedSizeTracker'].currentTrackedSize(newSessionId)
            ).toBe(0)
        })

        it('does NOT emit linking events when only noSessionId is true (like after reset)', () => {
            const tryAddCustomEvent = sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent'] as any
            // confirm user activity so the rotation callback defers the restart to
            // _updateWindowAndSessionIds and only the linking events are captured below
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: Date.now() }))
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
    })

    describe('stale config reads while stopped', () => {
        it.each(['status', 'sdkDebugProperties'] as const)(
            'preserves config and refreshes before restarting after a %s read',
            (read) => {
                addRRwebToWindow()
                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
                expect(sessionRecording.started).toBe(true)
                sessionRecording.stopRecording()
                expect(sessionRecording.started).toBe(false)

                const staleConfig = {
                    enabled: true,
                    endpoint: '/s/',
                    cache_timestamp: Date.now() - RECORDING_REMOTE_CONFIG_TTL_MS - 1,
                }
                posthog.persistence?.register({ [SESSION_RECORDING_REMOTE_CONFIG]: staleConfig })
                mockRemoteConfigLoad.mockClear()

                void sessionRecording[read]

                expect(posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG)).toEqual(staleConfig)
                sessionRecording.startIfEnabledOrStop()
                sessionRecording.startIfEnabledOrStop()
                expect(mockRemoteConfigLoad).toHaveBeenCalledTimes(1)
                expect(sessionRecording.started).toBe(false)

                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
                expect(sessionRecording.started).toBe(true)
            }
        )
    })

    describe('snapshot cost telemetry', () => {
        it('resets snapshot cost state after the old recorder stops on rotation, before the new one starts', () => {
            const rrwebStop = vi.fn()
            loadScriptMock.mockImplementation((_ph, _path, callback) => {
                addRRwebToWindow()
                const mock = assignableWindow.__PosthogExtensions__.rrweb.record as vi.Mock
                mock.mockImplementation(({ emit }) => {
                    _emit = emit
                    // the real stop records its teardown flush of deferred stylesheets
                    // into the global cost state, so it must run before the reset
                    return rrwebStop
                })
                callback()
            })
            const startTimestamp = Date.now()
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as vi.Mock
            const resetMock = assignableWindow.__PosthogExtensions__.rrweb.resetSnapshotCostState as vi.Mock
            expect(recordMock).toHaveBeenCalledTimes(1)
            resetMock.mockClear()

            // rotate the session externally, past the session timeout
            sessionIdGeneratorMock.mockImplementation(() => 'cost-rotated-session-id')
            const rotationTimestamp = sessionManager['_sessionTimeoutMs'] + startTimestamp + 1000
            vi.useFakeTimers().setSystemTime(new Date(rotationTimestamp))
            sessionManager.checkAndGetSessionAndWindowId(false, rotationTimestamp)

            expect(recordMock).toHaveBeenCalledTimes(2)
            expect(rrwebStop).toHaveBeenCalledTimes(1)
            expect(resetMock).toHaveBeenCalledTimes(1)
            // the old recorder's teardown-flush work belongs to the old session:
            // stop first, then reset, then start the new recorder
            expect(rrwebStop.mock.invocationCallOrder[0]).toBeLessThan(resetMock.mock.invocationCallOrder[0])
            expect(resetMock.mock.invocationCallOrder[0]).toBeLessThan(recordMock.mock.invocationCallOrder[1])
        })
    })
})
