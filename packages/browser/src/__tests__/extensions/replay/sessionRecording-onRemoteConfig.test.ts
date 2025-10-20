/// <reference lib="dom" />

import '@testing-library/jest-dom'

import { PostHogPersistence } from '../../../posthog-persistence'
import { SESSION_RECORDING_REMOTE_CONFIG } from '../../../constants'
import { SessionIdManager } from '../../../sessionid'
import { FULL_SNAPSHOT_EVENT_TYPE, META_EVENT_TYPE } from '../../../extensions/replay/external/sessionrecording-utils'
import { PostHog } from '../../../posthog-core'
import { FlagsResponse, PostHogConfig, Property } from '../../../types'
import { uuidv7 } from '../../../uuidv7'
import { SessionRecording } from '../../../extensions/replay/session-recording'
import { assignableWindow, window } from '../../../utils/globals'
import { RequestRouter } from '../../../utils/request-router'
import { type fullSnapshotEvent, type metaEvent } from '../../../extensions/replay/types/rrweb-types'
import Mock = jest.Mock
import { ConsentManager } from '../../../consent'
import { SimpleEventEmitter } from '../../../utils/simple-event-emitter'
import {
    allMatchSessionRecordingStatus,
    AndTriggerMatching,
    anyMatchSessionRecordingStatus,
    OrTriggerMatching,
} from '../../../extensions/replay/external/triggerMatching'
import { LazyLoadedSessionRecording } from '../../../extensions/replay/external/lazy-loaded-session-recorder'

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

function makeFlagsResponse(partialResponse: Partial<FlagsResponse>) {
    return partialResponse as unknown as FlagsResponse
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
                compress_events: false,
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

        assignableWindow.__PosthogExtensions__.initSessionRecording = () => {
            return new LazyLoadedSessionRecording(posthog)
        }

        sessionRecording = new SessionRecording(posthog)
    })

    afterEach(() => {
        // @ts-expect-error this is a test, it's safe to write to location like this
        window!.location = originalLocation
    })

    describe('onRemoteConfig()', () => {
        beforeEach(() => {
            jest.spyOn(sessionRecording, 'startIfEnabledOrStop')
        })

        it('loads script based on script config', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', scriptConfig: { script: 'experimental-recorder' } },
                })
            )
            expect(loadScriptMock).toHaveBeenCalledWith(posthog, 'experimental-recorder', expect.any(Function))
        })

        it('uses anyMatchSessionRecordingStatus when triggerMatching is "any"', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', triggerMatchType: 'any' },
                })
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_statusMatcher']).toBe(
                anyMatchSessionRecordingStatus
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_triggerMatching']).toBeInstanceOf(
                OrTriggerMatching
            )
        })

        it('uses allMatchSessionRecordingStatus when triggerMatching is "all"', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', triggerMatchType: 'all' },
                })
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_statusMatcher']).toBe(
                allMatchSessionRecordingStatus
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_triggerMatching']).toBeInstanceOf(
                AndTriggerMatching
            )
        })

        it('uses most restrictive when triggerMatching is not specified', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_statusMatcher']).toBe(
                allMatchSessionRecordingStatus
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_triggerMatching']).toBeInstanceOf(
                AndTriggerMatching
            )
        })

        it('when the first event is a meta it does not take a manual full snapshot', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['status']).toBe('active')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                ...EMPTY_BUFFER,
                sessionId: sessionId,
                windowId: 'windowId',
            })

            const metaSnapshot = createMetaSnapshot({ data: { href: 'https://example.com' } })
            _emit(metaSnapshot)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                data: [metaSnapshot],
                sessionId: sessionId,
                size: 48,
                windowId: 'windowId',
            })
        })

        it('when the first event is a full snapshot it does not take a manual full snapshot', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['status']).toBe('active')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                ...EMPTY_BUFFER,
                sessionId: sessionId,
                windowId: 'windowId',
            })

            const fullSnapshot = createFullSnapshot()
            _emit(fullSnapshot)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                data: [fullSnapshot],
                sessionId: sessionId,
                size: 20,
                windowId: 'windowId',
            })
        })

        it('emit is not active until flags is called', () => {
            expect(sessionRecording['status']).toBe('lazy_loading')

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            expect(sessionRecording['status']).toBe('active')
        })

        it('sample rate is null when flags does not return it', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_isSampled']).toBe(null)
        })

        it('stores true in persistence if recording is enabled from the server', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            expect(posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG).enabled).toBe(true)
        })

        it('stores true in persistence if canvas is enabled from the server', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', recordCanvas: true, canvasFps: 6, canvasQuality: '0.2' },
                })
            )

            expect(posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG).recordCanvas).toBe(true)
            expect(posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG).canvasFps).toBe(6)
            expect(posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG).canvasQuality).toBe('0.2')
        })

        it('stores masking config in persistence if set on the server', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', masking: { maskAllInputs: true, maskTextSelector: '*' } },
                })
            )

            expect(posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG).masking).toEqual({
                maskAllInputs: true,
                maskTextSelector: '*',
            })
        })

        it('stores nothing in persistence if recording is not returned from the server', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })

            sessionRecording.onRemoteConfig(makeFlagsResponse({}))

            expect(posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG)).toBe(undefined)
            expect(sessionRecording.status).toBe('lazy_loading')
        })

        it('stores response in persistence if recording is false from the server', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: false }))

            expect(sessionRecording.status).toBe('disabled')
        })

        it('stores sample rate', () => {
            posthog.persistence?.register({ SESSION_RECORDING_REMOTE_CONFIG: undefined })

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.70' },
                })
            )

            expect(posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG).sampleRate).toBe(0.7)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sampleRate']).toBe(0.7)
        })

        it('starts session recording, saves setting and endpoint when enabled', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/ses/' },
                })
            )

            expect(sessionRecording.startIfEnabledOrStop).toHaveBeenCalled()
            expect(loadScriptMock).toHaveBeenCalled()
            expect(posthog.get_property(SESSION_RECORDING_REMOTE_CONFIG).enabled).toBe(true)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_endpoint']).toEqual('/ses/')
        })
    })
})
