/// <reference lib="dom" />

import '@testing-library/jest-dom'

import { PostHogPersistence } from '../../../posthog-persistence'
import { SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED } from '../../../constants'
import { SessionIdManager } from '../../../sessionid'
import { FULL_SNAPSHOT_EVENT_TYPE } from '@posthog/browser-common/replay/external/sessionrecording-utils'
import { PostHog } from '../../../posthog-core'
import { FlagsResponse, PostHogConfig, Property, RemoteConfig, RemoteConfigResult } from '../../../types'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { SessionRecording } from '../../../extensions/replay/session-recording'
import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../../../utils/globals'
import { RequestRouter } from '../../../utils/request-router'
import { type fullSnapshotEvent } from '@posthog/browser-common/replay/rrweb-types'
import Mock = vi.Mock
import { ConsentManager } from '../../../consent'
import { SimpleEventEmitter } from '@posthog/browser-common/utils/simple-event-emitter'
import { LazyLoadedSessionRecording } from '../../../extensions/replay/external/lazy-loaded-session-recorder'
import { createMockPostHog, createMockConfig } from '../../helpers/posthog-instance'

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

const createFullSnapshot = (event = {}): fullSnapshotEvent =>
    ({
        type: FULL_SNAPSHOT_EVENT_TYPE,
        data: {},
        ...event,
    }) as fullSnapshotEvent

function makeFlagsResponse(partialResponse: Partial<FlagsResponse>): RemoteConfigResult {
    return { ok: true, config: partialResponse as unknown as RemoteConfig }
}

const originalLocation = window!.location

describe('SessionRecording', () => {
    const _addCustomEvent = vi.fn()
    const loadScriptMock = vi.fn()
    const registerForSessionMock = vi.fn()
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
            record: vi.fn(({ emit }) => {
                _emit = emit
                return () => {}
            }),
            version: 'fake',
        }
        assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot = vi.fn(() => {
            // we pretend to be rrweb and call emit
            _emit(createFullSnapshot())
        })
        assignableWindow.__PosthogExtensions__.rrweb.record.addCustomEvent = _addCustomEvent

        assignableWindow.__PosthogExtensions__.rrwebPlugins = {
            getRecordConsolePlugin: vi.fn(),
        }
    }

    beforeEach(() => {
        removePageviewCaptureHookMock = vi.fn()
        sessionId = 'sessionId' + uuidv7()

        config = createMockConfig({
            api_host: 'https://test.com',
            disable_session_recording: false,
            enable_recording_console_log: false,
            autocapture: false, // Assert that session recording works even if `autocapture = false`
            session_recording: {
                maskAllInputs: false,
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
            createMockPostHog({
                config,
                persistence: postHogPersistence,
                register: vi.fn(),
            }),
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
            capture: vi.fn(),
            persistence: postHogPersistence,
            register: vi.fn(),
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
            register_for_session: registerForSessionMock,
            _onRemoteConfig: vi.fn(),
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

        assignableWindow.__PosthogExtensions__.initSessionRecording = () => {
            return new LazyLoadedSessionRecording(posthog)
        }

        posthog._getBrowserClientAdapter = PostHog.prototype._getBrowserClientAdapter

        sessionRecording = new SessionRecording(posthog)

        sessionRecording.setup(posthog._getBrowserClientAdapter())
    })

    afterEach(() => {
        posthog.sessionManager?.destroy()
        if (posthog.sessionManager !== sessionManager) {
            sessionManager.destroy()
        }
        // @ts-expect-error this is a test, it's safe to write to location like this
        window!.location = originalLocation
    })

    describe('onRemoteConfig()', () => {
        beforeEach(() => {
            vi.spyOn(sessionRecording, 'startIfEnabledOrStop')
        })

        it('loads script based on script config', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        scriptConfig: { script: 'experimental-recorder' },
                    },
                })
            )
            expect(loadScriptMock).toHaveBeenCalledWith(posthog, 'experimental-recorder', expect.any(Function))
        })

        it('does not load the script when the recorder is already bundled in', () => {
            // this is what the `.full` bundles do at import time
            addRRwebToWindow()
            assignableWindow.__PosthogExtensions__.initSessionRecording = () => new LazyLoadedSessionRecording(posthog)

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            expect(loadScriptMock).not.toHaveBeenCalled()
            expect(sessionRecording.started).toBe(true)
        })

        it('still loads the script when only rrweb is bundled in', () => {
            // `posthog-js/dist/recorder` defines rrweb but not initSessionRecording
            addRRwebToWindow()
            assignableWindow.__PosthogExtensions__.initSessionRecording = undefined

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            expect(loadScriptMock).toHaveBeenCalledWith(posthog, 'lazy-recorder', expect.any(Function))
        })

        it('flags the session when the recorder script cannot be loaded', () => {
            loadScriptMock.mockImplementation((_ph, _path, callback) => callback('blocked'))

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            expect(registerForSessionMock).toHaveBeenCalledWith({
                [SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED]: true,
            })
        })

        it('does not flag the session when a stale recorder script load fails', () => {
            let finishLoading: ((error?: string) => void) | undefined
            loadScriptMock.mockImplementation((_ph, _path, callback) => {
                finishLoading = callback
            })

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            posthog.sessionManager = undefined
            finishLoading?.('blocked')

            expect(registerForSessionMock).not.toHaveBeenCalled()
            expect(sessionRecording.status).toBe('disabled')
        })

        it.each([
            ['consent is opted out', () => vi.spyOn(posthog.consent, 'isOptedOut').mockReturnValue(true)],
            ['the session manager is unavailable', () => (posthog.sessionManager = undefined)],
            ['the session manager is replaced', () => (posthog.sessionManager = new SessionIdManager(posthog))],
        ])('does not initialize after %s while the recorder script is loading', (_condition, disableRecording) => {
            let finishLoading: (() => void) | undefined
            loadScriptMock.mockImplementation((_ph, _path, callback) => {
                finishLoading = callback
            })
            const initSessionRecording = vi.fn(() => new LazyLoadedSessionRecording(posthog))
            assignableWindow.__PosthogExtensions__.initSessionRecording = initSessionRecording

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            expect(finishLoading).toBeDefined()

            disableRecording()
            addRRwebToWindow()

            expect(() => finishLoading?.()).not.toThrow()
            expect(initSessionRecording).not.toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']).toBeUndefined()
            expect(sessionRecording.status).toBe('disabled')
        })
    })
})
