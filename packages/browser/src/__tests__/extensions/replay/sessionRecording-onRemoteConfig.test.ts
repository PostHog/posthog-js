/// <reference lib="dom" />

import '@testing-library/jest-dom'

import { PostHogPersistence } from '../../../posthog-persistence'
import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_CANVAS_RECORDING,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_MASKING,
    SESSION_RECORDING_SAMPLE_RATE,
} from '../../../constants'
import { SessionIdManager } from '../../../sessionid'
import {
    FULL_SNAPSHOT_EVENT_TYPE,
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
} from '../../../extensions/replay/sessionrecording-utils'
import { PostHog } from '../../../posthog-core'
import { DecideResponse, PostHogConfig, Property } from '../../../types'
import { uuidv7 } from '../../../uuidv7'
import { SessionRecording } from '../../../extensions/replay/sessionrecording'
import { assignableWindow, window } from '../../../utils/globals'
import { RequestRouter } from '../../../utils/request-router'
import {
    type fullSnapshotEvent,
    type incrementalData,
    type incrementalSnapshotEvent,
    type metaEvent,
} from '@rrweb/types'
import Mock = jest.Mock
import { ConsentManager } from '../../../consent'
import { SimpleEventEmitter } from '../../../utils/simple-event-emitter'
import {
    allMatchSessionRecordingStatus,
    AndTriggerMatching,
    anyMatchSessionRecordingStatus,
    nullMatchSessionRecordingStatus,
    OrTriggerMatching,
    PendingTriggerMatching,
} from '../../../extensions/replay/triggerMatching'

// Type and source defined here designate a non-user-generated recording event

jest.mock('../../../config', () => ({ LIB_VERSION: '0.0.1' }))

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

function makeDecideResponse(partialResponse: Partial<DecideResponse>) {
    return partialResponse as unknown as DecideResponse
}

const originalLocation = window!.location

describe('SessionRecording', () => {
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
    }

    beforeEach(() => {
        removePageviewCaptureHookMock = jest.fn()
        sessionId = 'sessionId' + uuidv7()

        config = {
            api_host: 'https://test.com',
            disable_session_recording: false,
            enable_recording_console_log: false,
            autocapture: false, // Assert that session recording works even if `autocapture = false`
            session_recording: {
                maskAllInputs: false,
            },
            persistence: 'memory',
        } as unknown as PostHogConfig

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
            { config, persistence: postHogPersistence, register: jest.fn() } as unknown as PostHog,
            sessionIdGeneratorMock,
            windowIdGeneratorMock
        )

        simpleEventEmitter = new SimpleEventEmitter()
        // TODO we really need to make this a real posthog instance :cry:
        posthog = {
            get_property: (property_key: string): Property | undefined => {
                return postHogPersistence?.['props'][property_key]
            },
            config: config,
            capture: jest.fn(),
            persistence: postHogPersistence,
            onFeatureFlags: (): (() => void) => {
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
        window!.location = originalLocation
    })

    describe('onRemoteConfig()', () => {
        beforeEach(() => {
            jest.spyOn(sessionRecording, 'startIfEnabledOrStop')
        })

        it('has null status matcher before remote config', () => {
            expect(sessionRecording['_statusMatcher']).toBe(nullMatchSessionRecordingStatus)
            expect(sessionRecording['_triggerMatching']).toBeInstanceOf(PendingTriggerMatching)
        })

        it('loads script based on script config', () => {
            sessionRecording.onRemoteConfig(
                makeDecideResponse({
                    sessionRecording: { endpoint: '/s/', scriptConfig: { script: 'experimental-recorder' } },
                })
            )
            expect(loadScriptMock).toHaveBeenCalledWith(posthog, 'experimental-recorder', expect.any(Function))
        })

        it('uses anyMatchSessionRecordingStatus when triggerMatching is "any"', () => {
            sessionRecording.onRemoteConfig(
                makeDecideResponse({
                    sessionRecording: { endpoint: '/s/', triggerMatchType: 'any' },
                })
            )
            expect(sessionRecording['_statusMatcher']).toBe(anyMatchSessionRecordingStatus)
            expect(sessionRecording['_triggerMatching']).toBeInstanceOf(OrTriggerMatching)
        })

        it('uses allMatchSessionRecordingStatus when triggerMatching is "all"', () => {
            sessionRecording.onRemoteConfig(
                makeDecideResponse({
                    sessionRecording: { endpoint: '/s/', triggerMatchType: 'all' },
                })
            )
            expect(sessionRecording['_statusMatcher']).toBe(allMatchSessionRecordingStatus)
            expect(sessionRecording['_triggerMatching']).toBeInstanceOf(AndTriggerMatching)
        })

        it('uses most restrictive when triggerMatching is not specified', () => {
            sessionRecording.onRemoteConfig(
                makeDecideResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            expect(sessionRecording['_statusMatcher']).toBe(allMatchSessionRecordingStatus)
            expect(sessionRecording['_triggerMatching']).toBeInstanceOf(AndTriggerMatching)
        })

        it('when the first event is a meta it does not take a manual full snapshot', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['status']).toBe('buffering')
            expect(sessionRecording['_buffer']).toEqual({
                ...EMPTY_BUFFER,
                sessionId: sessionId,
                windowId: 'windowId',
            })

            const metaSnapshot = createMetaSnapshot({ data: { href: 'https://example.com' } })
            _emit(metaSnapshot)
            expect(sessionRecording['_buffer']).toEqual({
                data: [metaSnapshot],
                sessionId: sessionId,
                size: 48,
                windowId: 'windowId',
            })
        })

        it('when the first event is a full snapshot it does not take a manual full snapshot', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['status']).toBe('buffering')
            expect(sessionRecording['_buffer']).toEqual({
                ...EMPTY_BUFFER,
                sessionId: sessionId,
                windowId: 'windowId',
            })

            const fullSnapshot = createFullSnapshot()
            _emit(fullSnapshot)
            expect(sessionRecording['_buffer']).toEqual({
                data: [fullSnapshot],
                sessionId: sessionId,
                size: 20,
                windowId: 'windowId',
            })
        })

        it('buffers snapshots until decide is received and drops them if disabled', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['status']).toBe('buffering')
            expect(sessionRecording['_buffer']).toEqual({
                ...EMPTY_BUFFER,
                sessionId: sessionId,
                windowId: 'windowId',
            })

            const incrementalSnapshot = createIncrementalSnapshot({ data: { source: 1 } })
            _emit(incrementalSnapshot)
            expect(sessionRecording['_buffer']).toEqual({
                data: [incrementalSnapshot],
                sessionId: sessionId,
                size: 30,
                windowId: 'windowId',
            })

            sessionRecording.onRemoteConfig(makeDecideResponse({ sessionRecording: undefined }))
            expect(sessionRecording['status']).toBe('disabled')
            expect(sessionRecording['_buffer'].data.length).toEqual(0)
            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('emit is not active until decide is called', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['status']).toBe('buffering')

            sessionRecording.onRemoteConfig(makeDecideResponse({ sessionRecording: { endpoint: '/s/' } }))
            expect(sessionRecording['status']).toBe('active')
        })

        it('sample rate is null when decide does not return it', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['_isSampled']).toBe(null)

            sessionRecording.onRemoteConfig(makeDecideResponse({ sessionRecording: { endpoint: '/s/' } }))
            expect(sessionRecording['_isSampled']).toBe(null)
        })

        it('stores true in persistence if recording is enabled from the server', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_ENABLED_SERVER_SIDE]: undefined })

            sessionRecording.onRemoteConfig(makeDecideResponse({ sessionRecording: { endpoint: '/s/' } }))

            expect(posthog.get_property(SESSION_RECORDING_ENABLED_SERVER_SIDE)).toBe(true)
        })

        it('stores true in persistence if canvas is enabled from the server', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_CANVAS_RECORDING]: undefined })

            sessionRecording.onRemoteConfig(
                makeDecideResponse({
                    sessionRecording: { endpoint: '/s/', recordCanvas: true, canvasFps: 6, canvasQuality: '0.2' },
                })
            )

            expect(posthog.get_property(SESSION_RECORDING_CANVAS_RECORDING)).toEqual({
                enabled: true,
                fps: 6,
                quality: '0.2',
            })
        })

        it('stores masking config in persistence if set on the server', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_MASKING]: undefined })

            sessionRecording.onRemoteConfig(
                makeDecideResponse({
                    sessionRecording: { endpoint: '/s/', masking: { maskAllInputs: true, maskTextSelector: '*' } },
                })
            )

            expect(posthog.get_property(SESSION_RECORDING_MASKING)).toEqual({
                maskAllInputs: true,
                maskTextSelector: '*',
            })
        })

        it('stores false in persistence if recording is not enabled from the server', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_ENABLED_SERVER_SIDE]: undefined })

            sessionRecording.onRemoteConfig(makeDecideResponse({}))

            expect(posthog.get_property(SESSION_RECORDING_ENABLED_SERVER_SIDE)).toBe(false)
        })

        it('stores sample rate', () => {
            posthog.persistence?.register({ SESSION_RECORDING_SAMPLE_RATE: undefined })

            sessionRecording.onRemoteConfig(
                makeDecideResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.70' },
                })
            )

            expect(sessionRecording['_sampleRate']).toBe(0.7)
            expect(posthog.get_property(SESSION_RECORDING_SAMPLE_RATE)).toBe(0.7)
        })

        it('starts session recording, saves setting and endpoint when enabled', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_ENABLED_SERVER_SIDE]: undefined })
            sessionRecording.onRemoteConfig(
                makeDecideResponse({
                    sessionRecording: { endpoint: '/ses/' },
                })
            )

            expect(sessionRecording.startIfEnabledOrStop).toHaveBeenCalled()
            expect(loadScriptMock).toHaveBeenCalled()
            expect(posthog.get_property(SESSION_RECORDING_ENABLED_SERVER_SIDE)).toBe(true)
            expect(sessionRecording['_endpoint']).toEqual('/ses/')
        })
    })
})
