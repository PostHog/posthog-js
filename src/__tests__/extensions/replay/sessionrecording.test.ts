/// <reference lib="dom" />

import '@testing-library/jest-dom'

import { PostHogPersistence } from '../../../posthog-persistence'
import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_CANVAS_RECORDING,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_MASKING,
    SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE,
} from '../../../constants'
import { SessionIdManager } from '../../../sessionid'
import {
    FULL_SNAPSHOT_EVENT_TYPE,
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
} from '../../../extensions/replay/sessionrecording-utils'
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
import {
    RECORDING_IDLE_THRESHOLD_MS,
    RECORDING_MAX_EVENT_SIZE,
    SessionRecording,
} from '../../../extensions/replay/sessionrecording'
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
} from '@rrweb/types'
import Mock = jest.Mock
import { ConsentManager } from '../../../consent'
import { SimpleEventEmitter } from '../../../utils/simple-event-emitter'

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
    window!.location = { href } as Location
}

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
        window!.location = originalLocation
    })

    describe('isRecordingEnabled', () => {
        it('is enabled if both the server and client config says enabled', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_ENABLED_SERVER_SIDE]: true })
            expect(sessionRecording['_isRecordingEnabled']).toBeTruthy()
        })

        it('is disabled if the server is disabled', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_ENABLED_SERVER_SIDE]: false })
            expect(sessionRecording['_isRecordingEnabled']).toBe(false)
        })

        it('is disabled if the client config is disabled', () => {
            posthog.config.disable_session_recording = true
            expect(sessionRecording['_isRecordingEnabled']).toBe(false)
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
            (_name: string, serverSide: boolean | undefined, clientSide: boolean | undefined, expected: boolean) => {
                posthog.persistence?.register({ [CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: serverSide })
                posthog.config.enable_recording_console_log = clientSide
                expect(sessionRecording['_isConsoleLogCaptureEnabled']).toBe(expected)
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
            (_name: string, serverSide: boolean | undefined, clientSide: boolean | undefined, expected: boolean) => {
                posthog.persistence?.register({
                    [SESSION_RECORDING_CANVAS_RECORDING]: { enabled: serverSide, fps: 4, quality: '0.1' },
                })
                posthog.config.session_recording.captureCanvas = { recordCanvas: clientSide }
                expect(sessionRecording['_canvasRecording']).toMatchObject({ enabled: expected, fps: 4, quality: 0.1 })
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
                    [SESSION_RECORDING_CANVAS_RECORDING]: { enabled: true, fps, quality },
                })

                expect(sessionRecording['_canvasRecording']).toMatchObject({
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
            ['can be disabled when client object config only is set', undefined, { network_timing: false }, undefined],
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
        ])(
            '%s',
            (
                _name: string,
                serverSide: boolean | undefined,
                clientSide: boolean | PerformanceCaptureConfig | undefined,
                expected: boolean | undefined
            ) => {
                posthog.persistence?.register({
                    [SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE]: { capturePerformance: serverSide },
                })
                posthog.config.capture_performance = clientSide
                expect(sessionRecording['_networkPayloadCapture']?.recordPerformance).toBe(expected)
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
                    [SESSION_RECORDING_MASKING]: serverConfig,
                })

                posthog.config.session_recording.maskAllInputs = clientConfig?.maskAllInputs
                posthog.config.session_recording.maskTextSelector = clientConfig?.maskTextSelector
                posthog.config.session_recording.blockSelector = clientConfig?.blockSelector

                expect(sessionRecording['_masking']).toEqual(expected)
            }
        )
    })

    describe('startIfEnabledOrStop', () => {
        beforeEach(() => {
            // need to cast as any to mock private methods
            jest.spyOn(sessionRecording as any, '_startCapture')
            jest.spyOn(sessionRecording, 'stopRecording')
            jest.spyOn(sessionRecording as any, '_tryAddCustomEvent')
        })

        it('call _startCapture if its enabled', () => {
            sessionRecording.startIfEnabledOrStop()
            expect((sessionRecording as any)._startCapture).toHaveBeenCalled()
        })

        it('sets the pageview capture hook once', () => {
            expect(sessionRecording['_removePageViewCaptureHook']).toBeUndefined()

            sessionRecording.startIfEnabledOrStop()

            expect(sessionRecording['_removePageViewCaptureHook']).not.toBeUndefined()
            expect(posthog.on).toHaveBeenCalledTimes(1)

            // calling a second time doesn't add another capture hook
            sessionRecording.startIfEnabledOrStop()
            expect(posthog.on).toHaveBeenCalledTimes(1)
        })

        it('removes the pageview capture hook on stop', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording['_removePageViewCaptureHook']).not.toBeUndefined()

            expect(removePageviewCaptureHookMock).not.toHaveBeenCalled()
            sessionRecording.stopRecording()

            expect(removePageviewCaptureHookMock).toHaveBeenCalledTimes(1)
            expect(sessionRecording['_removePageViewCaptureHook']).toBeUndefined()
        })

        it('sets the window event listeners', () => {
            //mock window add event listener to check if it is called
            const addEventListener = jest.fn().mockImplementation(() => () => {})
            window.addEventListener = addEventListener

            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording['_onBeforeUnload']).not.toBeNull()
            // we register 4 event listeners
            expect(window.addEventListener).toHaveBeenCalledTimes(4)

            // window.addEventListener('blah', someFixedListenerInstance) is safe to call multiple times,
            // so we don't need to test if the addEvenListener registrations are called multiple times
        })

        it('emits an options event', () => {
            sessionRecording.startIfEnabledOrStop()
            expect((sessionRecording as any)['_tryAddCustomEvent']).toHaveBeenCalledWith('$session_options', {
                activePlugins: [],
                sessionRecordingOptions: {
                    blockClass: 'ph-no-capture',
                    blockSelector: undefined,
                    collectFonts: false,
                    ignoreClass: 'ph-ignore-input',
                    inlineStylesheet: true,
                    maskAllInputs: false,
                    maskInputFn: undefined,
                    maskInputOptions: { password: true },
                    maskTextClass: 'ph-mask',
                    maskTextFn: undefined,
                    maskTextSelector: undefined,
                    recordCrossOriginIframes: false,
                    slimDOMOptions: {},
                },
            })
        })

        it('call stopRecording if its not enabled', () => {
            posthog.config.disable_session_recording = true
            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording.stopRecording).toHaveBeenCalled()
        })
    })

    describe('recording', () => {
        describe('sampling', () => {
            it('does not emit to capture if the sample rate is 0', () => {
                sessionRecording.startIfEnabledOrStop()

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
                sessionRecording.startIfEnabledOrStop()

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: { endpoint: '/s/', sampleRate: null },
                    })
                )

                expect(sessionRecording.status).toBe('active')
            })

            it('stores excluded session when excluded', () => {
                sessionRecording.startIfEnabledOrStop()

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: { endpoint: '/s/', sampleRate: '0.00' },
                    })
                )

                expect(sessionRecording['_isSampled']).toStrictEqual(false)
            })

            it('does emit to capture if the sample rate is 1', () => {
                sessionRecording.startIfEnabledOrStop()

                _emit(createIncrementalSnapshot({ data: { source: 1 } }))
                expect(posthog.capture).not.toHaveBeenCalled()

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: { endpoint: '/s/', sampleRate: '1.00' },
                    })
                )
                _emit(createIncrementalSnapshot({ data: { source: 1 } }))

                expect(sessionRecording.status).toBe('sampled')
                expect(sessionRecording['_isSampled']).toStrictEqual(true)

                // don't wait two seconds for the flush timer
                sessionRecording['_flushBuffer']()

                _emit(createIncrementalSnapshot({ data: { source: 1 } }))
                expect(posthog.capture).toHaveBeenCalled()
            })

            it('sets emit as expected when sample rate is 0.5', () => {
                sessionRecording.startIfEnabledOrStop()

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: { endpoint: '/s/', sampleRate: '0.50' },
                    })
                )
                const emitValues: string[] = []
                let lastSessionId = sessionRecording['_sessionId']

                for (let i = 0; i < 100; i++) {
                    // force change the session ID
                    sessionManager.resetSessionId()
                    sessionId = 'session-id-' + uuidv7()
                    _emit(createIncrementalSnapshot({ data: { source: 1 } }))

                    expect(sessionRecording['_sessionId']).not.toBe(lastSessionId)
                    lastSessionId = sessionRecording['_sessionId']

                    emitValues.push(sessionRecording.status)
                }

                // the random number generator won't always be exactly 0.5, but it should be close
                expect(emitValues.filter((v) => v === 'sampled').length).toBeGreaterThan(30)
                expect(emitValues.filter((v) => v === 'disabled').length).toBeGreaterThan(30)
            })

            it('turning sample rate to null, means sessions are no longer sampled out', () => {
                sessionRecording.startIfEnabledOrStop()
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

            it('turning sample rate from null to 0, resets values as expected', () => {
                sessionRecording.startIfEnabledOrStop()

                // first turn sample rate to null
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({ sessionRecording: { endpoint: '/s/', sampleRate: null } })
                )

                // then check that a session is no longer sampled out (i.e. storage is cleared not false)
                expect(posthog.get_property(SESSION_RECORDING_IS_SAMPLED)).toBe(undefined)
                expect(sessionRecording.status).toBe('active')

                // set sample rate to 0, i.e. no sessions will run
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({ sessionRecording: { endpoint: '/s/', sampleRate: '0.00' } })
                )
                // then check that a session is sampled (i.e. storage is false not true or null)
                expect(posthog.get_property(SESSION_RECORDING_IS_SAMPLED)).toBe(false)
                expect(sessionRecording.status).toBe('disabled')
            })
        })

        describe('canvas', () => {
            it('passes the remote config to rrweb', () => {
                posthog.persistence?.register({
                    [SESSION_RECORDING_CANVAS_RECORDING]: {
                        enabled: true,
                        fps: 6,
                        quality: 0.2,
                    },
                })

                sessionRecording.startIfEnabledOrStop()

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
                sessionRecording.startIfEnabledOrStop()

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: { endpoint: '/s/', recordCanvas: null, canvasFps: null, canvasQuality: null },
                    })
                )

                sessionRecording['_onScriptLoaded']()

                const mockParams = assignableWindow.__PosthogExtensions__.rrweb.record.mock.calls[0][0]
                expect(mockParams).not.toHaveProperty('recordCanvas')
                expect(mockParams).not.toHaveProperty('canvasFps')
                expect(mockParams).not.toHaveProperty('canvasQuality')
            })
        })

        it('calls rrweb.record with the right options', () => {
            posthog.persistence?.register({ [CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: false })

            sessionRecording.startIfEnabledOrStop()
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

        describe('masking', () => {
            it('passes remote masking options to rrweb', () => {
                posthog.config.session_recording.maskAllInputs = undefined

                posthog.persistence?.register({
                    [SESSION_RECORDING_MASKING]: { maskAllInputs: true, maskTextSelector: '*' },
                })

                sessionRecording.startIfEnabledOrStop()

                sessionRecording['_onScriptLoaded']()

                expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                    expect.objectContaining({
                        maskAllInputs: true,
                        maskTextSelector: '*',
                    })
                )
            })
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
                sessionRecording.startIfEnabledOrStop()
                expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                    expect.objectContaining({
                        maskInputOptions: expect.objectContaining({ password: expected }),
                    })
                )
            })
        })

        it('records events emitted before and after starting recording', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).toHaveBeenCalled()

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            expect(posthog.capture).not.toHaveBeenCalled()

            expect(sessionRecording['_buffer']).toEqual({
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
            sessionRecording['_flushBuffer']()
            expect(sessionRecording['_buffer'].data.length).toEqual(0)

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
            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).toHaveBeenCalled()

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording['_flushBufferTimer']).not.toBeUndefined()

            sessionRecording['_flushBuffer']()
            expect(sessionRecording['_flushBufferTimer']).toBeUndefined()

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
            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).toHaveBeenCalled()
            const bigData = 'a'.repeat(RECORDING_MAX_EVENT_SIZE * 0.8)

            _emit(createIncrementalSnapshot({ data: { source: 1, payload: bigData } }))
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: 2 } }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording['_buffer']).toMatchObject({ size: 755101 })

            // Another big event means the old data will be flushed
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: bigData } }))
            expect(posthog.capture).toHaveBeenCalled()
            expect(sessionRecording['_buffer'].data.length).toEqual(1) // The new event
            expect(sessionRecording['_buffer']).toMatchObject({ size: 755017 })
        })

        it('maintains the buffer if the recording is buffering', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).toHaveBeenCalled()

            const bigData = 'a'.repeat(RECORDING_MAX_EVENT_SIZE * 0.8)

            _emit(createIncrementalSnapshot({ data: { source: 1, payload: bigData } }))
            expect(sessionRecording['_buffer']).toMatchObject({ size: 755017 }) // the size of the big data event
            expect(sessionRecording['_buffer'].data.length).toEqual(1) // full snapshot and a big event

            _emit(createIncrementalSnapshot({ data: { source: 1, payload: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: 2 } }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording['_buffer']).toMatchObject({ size: 755101 })

            // Another big event means the old data will be flushed
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: bigData } }))
            // but the recording is still buffering
            expect(sessionRecording.status).toBe('buffering')
            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording['_buffer'].data.length).toEqual(4) // + the new event
            expect(sessionRecording['_buffer']).toMatchObject({ size: 755017 + 755101 }) // the size of the big data event
        })

        it('flushes buffer if the session_id changes', () => {
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            sessionRecording.startIfEnabledOrStop()

            expect(sessionRecording['_buffer'].sessionId).toEqual(sessionId)

            _emit(createIncrementalSnapshot({ emit: 1 }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording['_buffer'].sessionId).not.toEqual(null)
            expect(sessionRecording['_buffer'].data).toEqual([{ data: { source: 1 }, emit: 1, type: 3 }])

            // Not exactly right but easier to test than rotating the session id
            // this simulates as the session id changing _after_ it has initially been set
            // i.e. the data in the buffer should be sent with 'otherSessionId'
            sessionRecording['_buffer']!.sessionId = 'otherSessionId'
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
            expect(sessionRecording['_buffer']).toEqual({
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
            addRRwebToWindow()
            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).not.toHaveBeenCalled()
        })

        it('loads recording script from right place', () => {
            sessionRecording.startIfEnabledOrStop()

            expect(loadScriptMock).toHaveBeenCalledWith(expect.anything(), 'recorder', expect.anything())
        })

        it('loads script after `_startCapture` if not previously loaded', () => {
            posthog.persistence?.register({ [SESSION_RECORDING_ENABLED_SERVER_SIDE]: false })

            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).not.toHaveBeenCalled()

            sessionRecording['_startCapture']()

            expect(loadScriptMock).toHaveBeenCalled()
        })

        it('does not load script if disable_session_recording passed', () => {
            posthog.config.disable_session_recording = true

            sessionRecording.startIfEnabledOrStop()
            sessionRecording['_startCapture']()

            expect(loadScriptMock).not.toHaveBeenCalled()
        })

        it('session recording can be turned on and off', () => {
            expect(sessionRecording['_stopRrweb']).toEqual(undefined)

            sessionRecording.startIfEnabledOrStop()

            expect(sessionRecording.started).toEqual(true)
            expect(sessionRecording['_stopRrweb']).not.toEqual(undefined)

            sessionRecording.stopRecording()

            expect(sessionRecording['_stopRrweb']).toEqual(undefined)
            expect(sessionRecording.started).toEqual(false)
        })

        it('session recording can be turned on after being turned off', () => {
            expect(sessionRecording['_stopRrweb']).toEqual(undefined)

            sessionRecording.startIfEnabledOrStop()

            expect(sessionRecording.started).toEqual(true)
            expect(sessionRecording['_stopRrweb']).not.toEqual(undefined)

            sessionRecording.stopRecording()

            expect(sessionRecording['_stopRrweb']).toEqual(undefined)
            expect(sessionRecording.started).toEqual(false)
        })

        it('can emit when there are circular references', () => {
            posthog.config.session_recording.compress_events = false
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            sessionRecording.startIfEnabledOrStop()

            const someObject = { emit: 1 }
            // the same object can be there multiple times
            const circularObject: Record<string, any> = { emit: someObject, again: someObject }
            // but a circular reference will be replaced
            circularObject.circularReference = circularObject
            _emit(createFullSnapshot(circularObject))

            expect(sessionRecording['_buffer']).toEqual({
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

        describe('console logs', () => {
            it('if not enabled, plugin is not used', () => {
                posthog.config.enable_recording_console_log = false

                sessionRecording.startIfEnabledOrStop()

                expect(
                    assignableWindow.__PosthogExtensions__.rrwebPlugins.getRecordConsolePlugin
                ).not.toHaveBeenCalled()
            })

            it('if enabled, plugin is used', () => {
                posthog.config.enable_recording_console_log = true

                sessionRecording.startIfEnabledOrStop()

                expect(assignableWindow.__PosthogExtensions__.rrwebPlugins.getRecordConsolePlugin).toHaveBeenCalled()
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
                    sessionManager = new SessionIdManager({
                        config,
                        persistence: new PostHogPersistence(config),
                        register: jest.fn(),
                    } as unknown as PostHog)
                    posthog.sessionManager = sessionManager

                    mockCallback = jest.fn()
                    unsubscribeCallback = sessionManager.onSessionId(mockCallback)

                    expect(mockCallback).not.toHaveBeenCalled()

                    sessionRecording.startIfEnabledOrStop()
                    sessionRecording['_startCapture']()

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
                    sessionManager = new SessionIdManager({
                        config,
                        persistence: new PostHogPersistence(config),
                        register: jest.fn(),
                    } as unknown as PostHog)
                    posthog.sessionManager = sessionManager

                    sessionRecording.startIfEnabledOrStop()
                    sessionRecording['_startCapture']()
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

                    sessionRecording.stopRecording = jest.fn()
                    sessionRecording.startIfEnabledOrStop = jest.fn()

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
                    expect(sessionRecording.stopRecording).toHaveBeenCalled()
                    expect(sessionRecording.startIfEnabledOrStop).toHaveBeenCalled()
                })

                it('restarts recording if the session is rotated because max time has passed', () => {
                    const startingSessionId = sessionManager['_getSessionId']()[1]

                    sessionRecording.stopRecording = jest.fn()
                    sessionRecording.startIfEnabledOrStop = jest.fn()

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

                    expect(sessionRecording.stopRecording).toHaveBeenCalled()
                    expect(sessionRecording.startIfEnabledOrStop).toHaveBeenCalled()
                })
            })
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
            expect(sessionRecording['_isIdle']).toEqual(expectIdle)
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
            expect(sessionRecording['_isIdle']).toEqual(false)
            if (expectedMatchingActivityTimestamp) {
                expect(sessionRecording['_lastActivityTimestamp']).toEqual(activityTimestamp)
            }
            return snapshotEvent
        }

        beforeEach(() => {
            sessionRecording.startIfEnabledOrStop()
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            expect(sessionRecording.status).toEqual('active')

            startingTimestamp = sessionRecording['_lastActivityTimestamp']
            expect(startingTimestamp).toBeGreaterThan(0)

            expect(assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot).toHaveBeenCalledTimes(0)

            // the buffer starts out empty
            expect(sessionRecording['_buffer']).toEqual({
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
            expect(sessionRecording['_isIdle']).toEqual('unknown')
        })

        it('does not emit events until after first active event', () => {
            const a = emitInactiveEvent(startingTimestamp + 100, 'unknown')
            const b = emitInactiveEvent(startingTimestamp + 110, 'unknown')
            const c = emitInactiveEvent(startingTimestamp + 120, 'unknown')

            _emit(createFullSnapshot({}), 'unknown')
            expect(sessionRecording['_isIdle']).toEqual('unknown')
            expect(posthog.capture).not.toHaveBeenCalled()

            const d = emitActiveEvent(startingTimestamp + 200)
            expect(sessionRecording['_isIdle']).toEqual(false)
            // but all events are buffered
            expect(sessionRecording['_buffer']).toEqual({
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
            sessionRecording['_isIdle'] = true
            // buffer is empty
            expect(sessionRecording['_buffer']).toEqual(emptyBuffer)

            sessionRecording.onRRwebEmit(createPluginSnapshot({}) as eventWithTime)

            // a plugin event doesn't count as returning from idle
            expect(sessionRecording['_isIdle']).toEqual(true)
            expect(sessionRecording['_buffer']).toEqual({
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
            sessionRecording['_isIdle'] = true
            // buffer is empty
            expect(sessionRecording['_buffer']).toEqual(emptyBuffer)

            sessionRecording.onRRwebEmit(createIncrementalSnapshot({}) as eventWithTime)

            // an incremental event counts as returning from idle
            expect(sessionRecording['_isIdle']).toEqual(false)
            // buffer contains event allowed when idle
            expect(sessionRecording['_buffer']).toEqual({
                data: [createIncrementalSnapshot({})],
                sessionId: sessionId,
                size: 30,
                windowId: 'windowId',
            })
        })

        it('does not emit buffered custom events while idle even when over buffer max size', () => {
            // force idle state
            sessionRecording['_isIdle'] = true
            // buffer is empty
            expect(sessionRecording['_buffer']).toEqual({
                ...EMPTY_BUFFER,
                sessionId: sessionId,
                windowId: 'windowId',
            })

            // ensure buffer isn't empty
            sessionRecording.onRRwebEmit(createCustomSnapshot({}) as eventWithTime)

            // fake having a large buffer
            // in reality we would need a very long idle period emitting custom events to reach 1MB of buffer data
            // particularly since we flush the buffer on entering idle
            sessionRecording['_buffer'].size = RECORDING_MAX_EVENT_SIZE - 1
            sessionRecording.onRRwebEmit(createCustomSnapshot({}) as eventWithTime)

            // we're still idle
            expect(sessionRecording['_isIdle']).toBe(true)
            // return from idle

            // we did not capture
            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('drops full snapshots when idle - so we must make sure not to take them while idle!', () => {
            // force idle state
            sessionRecording['_isIdle'] = true
            // buffer is empty
            expect(sessionRecording['_buffer']).toEqual({
                ...EMPTY_BUFFER,
                sessionId: sessionId,
                windowId: 'windowId',
            })

            sessionRecording.onRRwebEmit(createFullSnapshot({}) as eventWithTime)

            expect(sessionRecording['_buffer']).toEqual({
                data: [],
                sessionId: sessionId,
                size: 0,
                windowId: 'windowId',
            })
        })

        it('does not emit meta snapshot events when idle - so we must make sure not to take them while idle!', () => {
            // force idle state
            sessionRecording['_isIdle'] = true
            // buffer is empty
            expect(sessionRecording['_buffer']).toEqual({
                ...EMPTY_BUFFER,
                sessionId: sessionId,
                windowId: 'windowId',
            })

            sessionRecording.onRRwebEmit(createMetaSnapshot({}) as eventWithTime)

            expect(sessionRecording['_buffer']).toEqual({
                data: [],
                sessionId: sessionId,
                size: 0,
                windowId: 'windowId',
            })
        })

        it('does not emit style snapshot events when idle - so we must make sure not to take them while idle!', () => {
            // force idle state
            sessionRecording['_isIdle'] = true
            // buffer is empty
            expect(sessionRecording['_buffer']).toEqual({
                ...EMPTY_BUFFER,
                sessionId: sessionId,
                windowId: 'windowId',
            })

            sessionRecording.onRRwebEmit(createStyleSnapshot({}) as eventWithTime)

            expect(sessionRecording['_buffer']).toEqual({
                data: [],
                sessionId: sessionId,
                size: 0,
                windowId: 'windowId',
            })
        })

        it("enters idle state within one session if the activity is non-user generated and there's no activity for (RECORDING_IDLE_ACTIVITY_TIMEOUT_MS) 5 minutes", () => {
            const firstActivityTimestamp = startingTimestamp + 100
            const secondActivityTimestamp = startingTimestamp + 200
            const thirdActivityTimestamp = startingTimestamp + RECORDING_IDLE_THRESHOLD_MS + 1000
            const fourthActivityTimestamp = startingTimestamp + RECORDING_IDLE_THRESHOLD_MS + 2000

            const firstSnapshotEvent = emitActiveEvent(firstActivityTimestamp)
            // event was active so activity timestamp is updated
            expect(sessionRecording['_lastActivityTimestamp']).toEqual(firstActivityTimestamp)

            // after the first emit the buffer has been initialised but not flushed
            const firstSessionId = sessionRecording['_sessionId']
            expect(sessionRecording['_buffer']).toEqual({
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
            expect(sessionRecording['_lastActivityTimestamp']).toEqual(firstActivityTimestamp)

            // the second snapshot remains buffered in memory
            expect(sessionRecording['_buffer']).toEqual({
                data: [firstSnapshotEvent, secondSnapshot],
                sessionId: firstSessionId,
                size: 186,
                windowId: expect.any(String),
            })

            // this triggers idle state and isn't a user interaction so does not take a full snapshot
            emitInactiveEvent(thirdActivityTimestamp, true)

            // event was not active so activity timestamp is not updated
            expect(sessionRecording['_lastActivityTimestamp']).toEqual(firstActivityTimestamp)

            // the custom event doesn't show here since there's not a real rrweb to emit it
            expect(sessionRecording['_buffer']).toEqual({
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

            expect(sessionRecording['_lastActivityTimestamp']).toEqual(fourthActivityTimestamp)

            // the fourth snapshot should not trigger a flush because the session id has not changed...
            expect(sessionRecording['_buffer']).toEqual({
                // as we return from idle we will capture a full snapshot _before_ the fourth snapshot
                data: [fourthSnapshot],
                sessionId: firstSessionId,
                size: 68,
                windowId: expect.any(String),
            })

            // because not enough time passed while idle we still have the same session id at the end of this sequence
            const endingSessionId = sessionRecording['_sessionId']
            expect(endingSessionId).toEqual(firstSessionId)
        })

        it('rotates session if idle for (MAX_SESSION_IDLE_TIMEOUT) 30 minutes', () => {
            const firstActivityTimestamp = startingTimestamp + 100
            const secondActivityTimestamp = startingTimestamp + 200
            const thirdActivityTimestamp = sessionManager['_sessionTimeoutMs'] + startingTimestamp + 1
            const fourthActivityTimestamp = sessionManager['_sessionTimeoutMs'] + startingTimestamp + 1000

            const firstSnapshotEvent = emitActiveEvent(firstActivityTimestamp)
            // event was active so activity timestamp is updated
            expect(sessionRecording['_lastActivityTimestamp']).toEqual(firstActivityTimestamp)

            // after the first emit the buffer has been initialised but not flushed
            const firstSessionId = sessionRecording['_sessionId']
            expect(sessionRecording['_buffer']).toEqual({
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
            expect(sessionRecording['_lastActivityTimestamp']).toEqual(firstActivityTimestamp)

            // the second snapshot remains buffered in memory
            expect(sessionRecording['_buffer']).toEqual({
                data: [firstSnapshotEvent, secondSnapshot],
                sessionId: firstSessionId,
                size: 186,
                windowId: expect.any(String),
            })

            // this triggers idle state and isn't a user interaction so does not take a full snapshot

            emitInactiveEvent(thirdActivityTimestamp, true)

            // event was not active so activity timestamp is not updated
            expect(sessionRecording['_lastActivityTimestamp']).toEqual(firstActivityTimestamp)

            // the third snapshot is dropped since it switches the session to idle
            // the custom event doesn't show here since there's not a real rrweb to emit it
            expect(sessionRecording['_buffer']).toEqual({
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
            const endingSessionId = sessionRecording['_sessionId']
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
            expect(sessionRecording['_buffer']).toEqual({
                data: [fourthSnapshot],
                sessionId: rotatedSessionId,
                size: 68,
                windowId: expect.any(String),
            })
        })
    })

    describe('linked flags', () => {
        it('stores the linked flag on flags response', () => {
            expect(sessionRecording['_linkedFlagMatching'].linkedFlag).toEqual(null)
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({ sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' } })
            )

            expect(sessionRecording['_linkedFlagMatching'].linkedFlag).toEqual('the-flag-key')
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.(['the-flag-key'], { 'the-flag-key': true })
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('active')

            onFeatureFlagsCallback?.(['different', 'keys'], { different: true, keys: true })
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('does not react to flags that are present but false', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({ sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' } })
            )

            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.(['the-flag-key'], { 'the-flag-key': false })
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('can handle linked flags with variants', () => {
            expect(sessionRecording['_linkedFlagMatching'].linkedFlag).toEqual(null)
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', linkedFlag: { flag: 'the-flag-key', variant: 'test-a' } },
                })
            )

            expect(sessionRecording['_linkedFlagMatching'].linkedFlag).toEqual({
                flag: 'the-flag-key',
                variant: 'test-a',
            })
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.(['the-flag-key'], { 'the-flag-key': 'test-a' })
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('active')

            onFeatureFlagsCallback?.(['the-flag-key'], { 'the-flag-key': 'control' })
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('can handle linked flags with any variants', () => {
            expect(sessionRecording['_linkedFlagMatching'].linkedFlag).toEqual(null)
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    // when the variant is any we only send the key
                    sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' },
                })
            )

            expect(sessionRecording['_linkedFlagMatching'].linkedFlag).toEqual('the-flag-key')
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.(['the-flag-key'], { 'the-flag-key': 'literally-anything' })
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('active')

            onFeatureFlagsCallback?.(['not-the-flag-key'], { 'not-the-flag-key': 'literally-anything' })
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('can be overriden', () => {
            expect(sessionRecording['_linkedFlagMatching'].linkedFlag).toEqual(null)
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({ sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' } })
            )

            expect(sessionRecording['_linkedFlagMatching'].linkedFlag).toEqual('the-flag-key')
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            sessionRecording.overrideLinkedFlag()

            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
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

            expect(sessionRecording['_linkedFlagMatching'].linkedFlag).toEqual(null)
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

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

            expect(sessionRecording['_linkedFlagMatching'].linkedFlag).toEqual('the-flag-key')
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
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

            expect(sessionRecording['_linkedFlagMatching'].linkedFlag).toEqual('the-flag-key')
            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('paused')

            sessionRecording.overrideLinkedFlag()

            expect(sessionRecording['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('paused')

            fakeNavigateTo('https://test.com/allowed')

            expect(sessionRecording.status).toEqual('paused')

            _emit(snapshotEvent)
            expect(sessionRecording.status).toEqual('active')
        })
    })

    describe('buffering minimum duration', () => {
        it('can report no duration when no data', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording.status).toBe('buffering')
            expect(sessionRecording['_sessionDuration']).toBe(null)
        })

        it('can report zero duration', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording.status).toBe('buffering')
            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp }))
            expect(sessionRecording['_sessionDuration']).toBe(0)
        })

        it('can report a duration', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording.status).toBe('buffering')
            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 100 }))
            expect(sessionRecording['_sessionDuration']).toBe(100)
        })

        it('starts with an undefined minimum duration', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording['_minimumDuration']).toBe(null)
        })

        it('can set minimum duration from flags response', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )
            expect(sessionRecording['_minimumDuration']).toBe(1500)
        })

        it('does not flush if below the minimum duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )
            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording.status).toBe('active')
            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 100 }))
            expect(sessionRecording['_sessionDuration']).toBe(100)
            expect(sessionRecording['_minimumDuration']).toBe(1500)

            expect(sessionRecording['_buffer'].data.length).toBe(1) // the emitted incremental event
            // call the private method to avoid waiting for the timer
            sessionRecording['_flushBuffer']()

            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('does flush if session duration is negative', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )
            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording.status).toBe('active')
            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)

            // if we have some data in the buffer and the buffer has a session id but then the session id changes
            // then the session duration will be negative, and we will never flush the buffer
            // this setup isn't quite that but does simulate the behaviour closely enough
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp - 1000 }))

            expect(sessionRecording['_sessionDuration']).toBe(-1000)
            expect(sessionRecording['_minimumDuration']).toBe(1500)

            expect(sessionRecording['_buffer'].data.length).toBe(1) // the emitted incremental event
            // call the private method to avoid waiting for the timer
            sessionRecording['_flushBuffer']()

            expect(posthog.capture).toHaveBeenCalled()
        })

        it('does not stay buffering after the minimum duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )
            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording.status).toBe('active')
            const { sessionStartTimestamp } = sessionManager.checkAndGetSessionAndWindowId(true)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 100 }))
            expect(sessionRecording['_sessionDuration']).toBe(100)
            expect(sessionRecording['_minimumDuration']).toBe(1500)

            expect(sessionRecording['_buffer'].data.length).toBe(1) // the emitted incremental event
            // call the private method to avoid waiting for the timer
            sessionRecording['_flushBuffer']()

            expect(posthog.capture).not.toHaveBeenCalled()

            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 1501 }))

            expect(sessionRecording['_buffer'].data.length).toBe(2) // two emitted incremental events
            // call the private method to avoid waiting for the timer
            sessionRecording['_flushBuffer']()

            expect(posthog.capture).toHaveBeenCalled()
            expect(sessionRecording['_buffer'].data.length).toBe(0)
            expect(sessionRecording['_sessionDuration']).toBe(null)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 1502 }))
            expect(sessionRecording['_buffer'].data.length).toBe(1)
            expect(sessionRecording['_sessionDuration']).toBe(1502)
            // call the private method to avoid waiting for the timer
            sessionRecording['_flushBuffer']()

            expect(posthog.capture).toHaveBeenCalled()
            expect(sessionRecording['_buffer'].data.length).toBe(0)
        })
    })

    describe('when rrweb is not available', () => {
        beforeEach(() => {
            // Fake rrweb not being available
            loadScriptMock.mockImplementation((_ph, _path, callback) => {
                callback()
            })
            sessionRecording = new SessionRecording(posthog)

            expect(sessionRecording['_queuedRRWebEvents']).toHaveLength(0)

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            expect(sessionRecording['_queuedRRWebEvents']).toHaveLength(1)

            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).toHaveBeenCalled()
        })

        it('queues events', () => {
            sessionRecording['_tryAddCustomEvent']('test', { test: 'test' })

            expect(sessionRecording['_queuedRRWebEvents']).toHaveLength(2)
        })

        it('limits the queue of events', () => {
            sessionRecording['_tryAddCustomEvent']('test', { test: 'test' })

            expect(sessionRecording['_queuedRRWebEvents']).toHaveLength(2)

            for (let i = 0; i < 100; i++) {
                sessionRecording['_tryAddCustomEvent']('test', { test: 'test' })
            }

            expect(sessionRecording['_queuedRRWebEvents']).toHaveLength(10)
        })

        it('processes the queue when rrweb is available again', () => {
            addRRwebToWindow()

            sessionRecording.onRRwebEmit(createIncrementalSnapshot({ data: { source: 1 } }) as any)

            expect(sessionRecording['_queuedRRWebEvents']).toHaveLength(0)
        })
    })

    describe('scheduled full snapshots', () => {
        it('starts out unscheduled', () => {
            expect(sessionRecording['_fullSnapshotTimer']).toBe(undefined)
        })

        it('does not schedule a snapshot on start', () => {
            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording['_fullSnapshotTimer']).toBe(undefined)
        })

        it('schedules a snapshot, when we take a full snapshot', () => {
            sessionRecording.startIfEnabledOrStop()
            const startTimer = sessionRecording['_fullSnapshotTimer']

            _emit(createFullSnapshot())

            expect(sessionRecording['_fullSnapshotTimer']).not.toBe(undefined)
            expect(sessionRecording['_fullSnapshotTimer']).not.toBe(startTimer)
        })
    })

    describe('when pageview capture is disabled', () => {
        beforeEach(() => {
            jest.spyOn(sessionRecording as any, '_tryAddCustomEvent')
            posthog.config.capture_pageview = false
            sessionRecording.startIfEnabledOrStop()
            // clear the spy calls
            ;(sessionRecording as any)._tryAddCustomEvent.mockClear()
        })

        it('does not capture pageview on meta event', () => {
            _emit(createIncrementalSnapshot({ type: META_EVENT_TYPE }))

            expect((sessionRecording as any)['_tryAddCustomEvent']).not.toHaveBeenCalled()
        })

        it('captures pageview as expected on non-meta event', () => {
            fakeNavigateTo('https://test.com')

            _emit(createIncrementalSnapshot({ type: 3 }))

            expect((sessionRecording as any)['_tryAddCustomEvent']).toHaveBeenCalledWith('$url_changed', {
                href: 'https://test.com',
            })
            ;(sessionRecording as any)._tryAddCustomEvent.mockClear()

            _emit(createIncrementalSnapshot({ type: 3 }))
            // the window href has not changed, so we don't capture another pageview
            expect((sessionRecording as any)['_tryAddCustomEvent']).not.toHaveBeenCalled()

            fakeNavigateTo('https://test.com/other')
            _emit(createIncrementalSnapshot({ type: 3 }))

            // the window href has changed, so we capture another pageview
            expect((sessionRecording as any)['_tryAddCustomEvent']).toHaveBeenCalledWith('$url_changed', {
                href: 'https://test.com/other',
            })
        })
    })

    describe('when pageview capture is enabled', () => {
        beforeEach(() => {
            jest.spyOn(sessionRecording as any, '_tryAddCustomEvent')
            posthog.config.capture_pageview = true
            sessionRecording.startIfEnabledOrStop()
            // clear the spy calls
            ;(sessionRecording as any)._tryAddCustomEvent.mockClear()
        })

        it('does not capture pageview on rrweb events', () => {
            _emit(createIncrementalSnapshot({ type: 3 }))

            expect((sessionRecording as any)['_tryAddCustomEvent']).not.toHaveBeenCalled()
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
            sessionRecording.startIfEnabledOrStop()
            // need to have active event to start recording
            _emit(createIncrementalSnapshot({ type: 3 }))
            sessionRecording['_flushBuffer']()
        })

        it('compresses full snapshot data', () => {
            _emit(
                createFullSnapshot({
                    data: {
                        content: Array(30).fill(uuidv7()).join(''),
                    },
                })
            )
            sessionRecording['_flushBuffer']()

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

        it('does not compress small full snapshot data', () => {
            _emit(createFullSnapshot({ data: { content: 'small' } }))
            sessionRecording['_flushBuffer']()

            expect(posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                {
                    $snapshot_data: [
                        {
                            data: { content: 'small' },
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
            sessionRecording['_flushBuffer']()

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
            sessionRecording['_flushBuffer']()

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
            sessionRecording['_flushBuffer']()

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
            sessionRecording['_flushBuffer']()

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
            sessionRecording['_flushBuffer']()

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

    describe('URL blocking', () => {
        beforeEach(() => {
            sessionRecording.startIfEnabledOrStop()
            jest.spyOn(sessionRecording as any, '_tryAddCustomEvent')
        })

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

            expect(sessionRecording['_buffer'].data).toEqual([
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

            expect(sessionRecording['_buffer'].data).toStrictEqual([
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
            expect(sessionRecording.status).toBe('disabled')
            expect(sessionRecording['_urlTriggerMatching']['urlBlocked']).toBe(false)
            expect(sessionRecording['_buffer'].data).toHaveLength(0)

            fakeNavigateTo('https://test.com/blocked')
            // check is trigger by rrweb emit, not the navigation per se, so...
            _emit(createFullSnapshot({ data: { source: 1 } }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording.status).toBe('paused')
            expect(sessionRecording['_urlTriggerMatching']['urlBlocked']).toBe(true)
            expect(sessionRecording['_buffer'].data).toHaveLength(0)
            expect((sessionRecording as any)['_tryAddCustomEvent']).toHaveBeenCalledWith('recording paused', {
                reason: 'url blocker',
            })
            ;(sessionRecording as any)['_tryAddCustomEvent'].mockClear()

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            // regression: to check we've not accidentally got stuck in a pausing loop
            expect((sessionRecording as any)['_tryAddCustomEvent']).not.toHaveBeenCalledWith('recording paused', {
                reason: 'url blocker',
            })
        })
    })

    describe('Event triggering', () => {
        beforeEach(() => {
            sessionRecording.startIfEnabledOrStop()
        })

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

            expect(sessionRecording['_buffer'].data).toHaveLength(2)

            simpleEventEmitter.emit('eventCaptured', { event: 'not-$exception' })

            expect(sessionRecording.status).toBe('buffering')

            simpleEventEmitter.emit('eventCaptured', { event: '$exception' })

            expect(sessionRecording.status).toBe('active')
            expect(sessionRecording['_buffer'].data).toHaveLength(0)
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

            expect(sessionRecording['_buffer'].data).toHaveLength(2)

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

            expect(sessionRecording['_buffer'].data).toHaveLength(2)

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
            expect(sessionRecording['_buffer'].data).toHaveLength(0)

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
            expect(sessionRecording['_buffer'].data).toHaveLength(0)

            // Emit some events before hitting event trigger
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            simpleEventEmitter.emit('eventCaptured', { event: '$exception' })
            expect(sessionRecording.status).toBe('active')
            expect(posthog.capture).toHaveBeenCalled()
        })
    })
})
