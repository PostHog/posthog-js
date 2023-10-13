import { loadScript } from '../../utils'
import {
    RECORDING_IDLE_ACTIVITY_TIMEOUT_MS,
    RECORDING_MAX_EVENT_SIZE,
    SessionRecording,
} from '../../extensions/sessionrecording'
import { PostHogPersistence } from '../../posthog-persistence'
import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE,
} from '../../constants'
import { SessionIdManager } from '../../sessionid'
import {
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
    MUTATION_SOURCE_TYPE,
} from '../../extensions/sessionrecording-utils'

// Type and source defined here designate a non-user-generated recording event

jest.mock('../../utils', () => ({
    ...jest.requireActual('../../utils'),
    loadScript: jest.fn((path, callback) => callback()),
}))
jest.mock('../../config', () => ({ LIB_VERSION: 'v0.0.1' }))

const createIncrementalSnapshot = (event = {}) => ({
    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    data: {
        source: 1,
    },
    ...event,
})

describe('SessionRecording', () => {
    let _emit
    let posthog
    let sessionRecording
    const incomingSessionAndWindowId = { sessionId: 'sessionId', windowId: 'windowId' }
    let sessionManager
    let config
    let session_recording_recorder_version_server_side
    let session_recording_enabled_server_side
    let console_log_enabled_server_side

    beforeEach(() => {
        window.rrwebRecord = jest.fn()
        window.rrwebConsoleRecord = { getRecordConsolePlugin: jest.fn() }

        session_recording_enabled_server_side = true
        console_log_enabled_server_side = false
        session_recording_recorder_version_server_side = 'v2'

        config = {
            api_host: 'https://test.com',
            disable_session_recording: false,
            enable_recording_console_log: false,
            autocapture: false, // Assert that session recording works even if `autocapture = false`
            session_recording: {
                maskAllInputs: false,
                someUnregisteredProp: 'abc',
            },
            persistence: 'memory',
        }

        sessionManager = {
            checkAndGetSessionAndWindowId: jest.fn(),
        }
        // set the default behaviour for the mock
        sessionManager.checkAndGetSessionAndWindowId.mockImplementation(() => incomingSessionAndWindowId)

        posthog = {
            get_property: (property_key) => {
                if (property_key === SESSION_RECORDING_ENABLED_SERVER_SIDE) {
                    return session_recording_enabled_server_side
                } else if (property_key === SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE) {
                    return session_recording_recorder_version_server_side
                } else if (property_key === CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE) {
                    return console_log_enabled_server_side
                } else {
                    throw new Error('config has not been mocked for this property key: ' + property_key)
                }
            },
            config: config,
            capture: jest.fn(),
            persistence: { register: jest.fn() },
            sessionManager: sessionManager,
            _addCaptureHook: jest.fn(),
        }

        sessionRecording = new SessionRecording(posthog)
    })

    describe('isRecordingEnabled', () => {
        it('is enabled if both the server and client config says enabled', () => {
            session_recording_enabled_server_side = true
            expect(sessionRecording.isRecordingEnabled()).toBeTruthy()
        })

        it('is disabled if the server is disabled', () => {
            session_recording_enabled_server_side = false
            expect(sessionRecording.isRecordingEnabled()).toBe(false)
        })

        it('is disabled if the client config is disabled', () => {
            posthog.config.disable_session_recording = true
            expect(sessionRecording.isRecordingEnabled()).toBe(false)
        })
    })

    describe('isConsoleLogCaptureEnabled', () => {
        it('uses client side setting when set to false', () => {
            console_log_enabled_server_side = true
            posthog.config.enable_recording_console_log = false
            expect(sessionRecording.isConsoleLogCaptureEnabled()).toBe(false)
        })

        it('uses client side setting when set to true', () => {
            console_log_enabled_server_side = false
            posthog.config.enable_recording_console_log = true
            expect(sessionRecording.isConsoleLogCaptureEnabled()).toBe(true)
        })

        it('uses server side setting if client side setting is not set', () => {
            posthog.config.enable_recording_console_log = undefined
            console_log_enabled_server_side = false
            expect(sessionRecording.isConsoleLogCaptureEnabled()).toBe(false)

            console_log_enabled_server_side = true
            expect(sessionRecording.isConsoleLogCaptureEnabled()).toBe(true)
        })
    })

    describe('getRecordingVersion', () => {
        it('uses client side setting v2 over server side', () => {
            session_recording_recorder_version_server_side = 'v1'
            posthog.config.session_recording.recorderVersion = 'v2'
            expect(sessionRecording.getRecordingVersion()).toBe('v2')
        })

        it('uses client side setting v1 over server side', () => {
            session_recording_recorder_version_server_side = 'v2'
            posthog.config.session_recording.recorderVersion = 'v1'
            expect(sessionRecording.getRecordingVersion()).toBe('v1')
        })

        it('uses server side setting if client side setting is not set', () => {
            posthog.config.session_recording.recorderVersion = undefined

            session_recording_recorder_version_server_side = 'v1'
            expect(sessionRecording.getRecordingVersion()).toBe('v1')

            session_recording_recorder_version_server_side = 'v2'
            expect(sessionRecording.getRecordingVersion()).toBe('v2')

            session_recording_recorder_version_server_side = undefined
            expect(sessionRecording.getRecordingVersion()).toBe('v1')
        })
    })

    describe('startRecordingIfEnabled', () => {
        beforeEach(() => {
            jest.spyOn(sessionRecording, 'startCaptureAndTrySendingQueuedSnapshots')
            jest.spyOn(sessionRecording, 'stopRecording')
        })

        it('call startCaptureAndTrySendingQueuedSnapshots if its enabled', () => {
            sessionRecording.startRecordingIfEnabled()
            expect(sessionRecording.startCaptureAndTrySendingQueuedSnapshots).toHaveBeenCalled()
        })

        it('call stopRecording if its not enabled', () => {
            posthog.config.disable_session_recording = true
            sessionRecording.startRecordingIfEnabled()
            expect(sessionRecording.stopRecording).toHaveBeenCalled()
        })
    })

    describe('afterDecideResponse()', () => {
        beforeEach(() => {
            jest.spyOn(sessionRecording, 'startRecordingIfEnabled')

            loadScript.mockImplementation((path, callback) => callback())
        })

        it('emit is not set to true until decide is called', () => {
            sessionRecording.startRecordingIfEnabled()
            expect(loadScript).toHaveBeenCalled()
            expect(sessionRecording.emit).toBe(false)

            sessionRecording.afterDecideResponse({ sessionRecording: { endpoint: '/s/' } })
            expect(sessionRecording.emit).toBe(true)
        })

        it('stores true in persistence if recording is enabled from the server', () => {
            sessionRecording.afterDecideResponse({ sessionRecording: { endpoint: '/s/' } })

            expect(posthog.persistence.register).toHaveBeenCalledWith({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: true,
            })
        })

        it('stores false in persistence if recording is not enabled from the server', () => {
            sessionRecording.afterDecideResponse({})
            expect(posthog.persistence.register).toHaveBeenCalledWith({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: false,
            })
        })

        it('starts session recording, saves setting and endpoint when enabled', () => {
            sessionRecording.afterDecideResponse({ sessionRecording: { endpoint: '/ses/' } })

            expect(sessionRecording.startRecordingIfEnabled).toHaveBeenCalled()
            expect(loadScript).toHaveBeenCalled()
            expect(posthog.persistence.register).toHaveBeenCalledWith({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: true,
            })
            expect(sessionRecording.endpoint).toEqual('/ses/')
        })
    })

    describe('recording', () => {
        beforeEach(() => {
            const mockFullSnapshot = jest.fn()
            ;(window.rrwebRecord = jest.fn(({ emit }) => {
                _emit = emit
                return () => {}
            })),
                (window.rrwebRecord.takeFullSnapshot = mockFullSnapshot)
            loadScript.mockImplementation((path, callback) => callback())
        })

        it('calls rrweb.record with the right options', () => {
            console_log_enabled_server_side = false
            sessionRecording._onScriptLoaded()

            // maskAllInputs should change from default
            // someUnregisteredProp should not be present
            expect(window.rrwebRecord).toHaveBeenCalledWith({
                emit: expect.anything(),
                maskAllInputs: false,
                blockClass: 'ph-no-capture',
                blockSelector: undefined,
                ignoreClass: 'ph-ignore-input',
                maskTextClass: 'ph-mask',
                maskTextSelector: undefined,
                maskInputOptions: {},
                maskInputFn: undefined,
                slimDOMOptions: {},
                collectFonts: false,
                plugins: [],
                inlineStylesheet: true,
                recordCrossOriginIframes: false,
            })
        })

        it('records events emitted before and after starting recording', () => {
            sessionRecording.startRecordingIfEnabled()
            expect(loadScript).toHaveBeenCalled()

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            expect(posthog.capture).not.toHaveBeenCalled()

            sessionRecording.afterDecideResponse({ endpoint: '/s/' })
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            sessionRecording._flushBuffer()

            expect(posthog.capture).toHaveBeenCalledTimes(1)
            expect(posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                {
                    $snapshot_bytes: 60,
                    $snapshot_data: [
                        { type: 3, data: { source: 1 } },
                        { type: 3, data: { source: 2 } },
                    ],
                    $session_id: 'sessionId',
                    $window_id: 'windowId',
                },
                {
                    transport: 'XHR',
                    method: 'POST',
                    endpoint: '/s/',
                    _noTruncate: true,
                    _batchKey: 'recordings',
                    _metrics: expect.anything(),
                }
            )
        })

        it('buffers emitted events', () => {
            sessionRecording.afterDecideResponse({ endpoint: '/s/' })
            sessionRecording.startRecordingIfEnabled()
            expect(loadScript).toHaveBeenCalled()

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording.flushBufferTimer).not.toBeUndefined()

            sessionRecording._flushBuffer()
            expect(sessionRecording.flushBufferTimer).toBeUndefined()

            expect(posthog.capture).toHaveBeenCalledTimes(1)
            expect(posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                {
                    $session_id: 'sessionId',
                    $window_id: 'windowId',
                    $snapshot_bytes: 60,
                    $snapshot_data: [
                        { type: 3, data: { source: 1 } },
                        { type: 3, data: { source: 2 } },
                    ],
                },
                {
                    method: 'POST',
                    transport: 'XHR',
                    endpoint: '/s/',
                    _noTruncate: true,
                    _batchKey: 'recordings',
                    _metrics: expect.anything(),
                }
            )
        })

        it('flushes buffer if the size of the buffer hits the limit', () => {
            sessionRecording.afterDecideResponse({ endpoint: '/s/' })
            sessionRecording.startRecordingIfEnabled()
            expect(loadScript).toHaveBeenCalled()
            const bigData = 'a'.repeat(RECORDING_MAX_EVENT_SIZE * 0.8)

            _emit(createIncrementalSnapshot({ data: { source: 1, payload: bigData } }))
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: 2 } }))

            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording.buffer).toMatchObject({ size: 755101 })

            // Another big event means the old data will be flushed
            _emit(createIncrementalSnapshot({ data: { source: 1, payload: bigData } }))
            expect(posthog.capture).toHaveBeenCalled()
            expect(sessionRecording.buffer.data.length).toEqual(1) // The new event
            expect(sessionRecording.buffer).toMatchObject({ size: 755017 })
        })

        it('flushes buffer if the session_id changes', () => {
            sessionRecording.afterDecideResponse({ endpoint: '/s/' })
            sessionRecording.startRecordingIfEnabled()

            _emit(createIncrementalSnapshot())
            expect(posthog.capture).not.toHaveBeenCalled()
            expect(sessionRecording.buffer.sessionId).toEqual('sessionId')
            // Not exactly right but easier to test than rotating the session id
            sessionRecording.buffer.sessionId = 'otherSessionId'
            _emit(createIncrementalSnapshot())
            expect(posthog.capture).toHaveBeenCalled()
            expect(posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                {
                    $session_id: 'otherSessionId',
                    $window_id: 'windowId',
                    $snapshot_data: [{ type: 3, data: { source: 1 } }],
                    $snapshot_bytes: 30,
                },
                {
                    method: 'POST',
                    transport: 'XHR',
                    endpoint: '/s/',
                    _noTruncate: true,
                    _batchKey: 'recordings',
                    _metrics: expect.anything(),
                }
            )
        })

        it("doesn't load recording script if already loaded", () => {
            posthog.__loaded_recorder_version = 'v2'
            sessionRecording.startRecordingIfEnabled()
            expect(loadScript).not.toHaveBeenCalled()
        })

        it('loads recording v1 script from right place', () => {
            posthog.config.session_recording.recorderVersion = 'v1'

            sessionRecording.startRecordingIfEnabled()

            expect(loadScript).toHaveBeenCalledWith('https://test.com/static/recorder.js?v=v0.0.1', expect.anything())
        })

        it('loads recording v2 script from right place', () => {
            session_recording_recorder_version_server_side = 'v2'
            sessionRecording.startRecordingIfEnabled()

            expect(loadScript).toHaveBeenCalledWith(
                'https://test.com/static/recorder-v2.js?v=v0.0.1',
                expect.anything()
            )
        })

        it('load correct recording version if there is a cached mismatch', () => {
            posthog.__loaded_recorder_version = 'v1'
            session_recording_recorder_version_server_side = 'v2'
            sessionRecording.startRecordingIfEnabled()

            expect(loadScript).toHaveBeenCalledWith(
                'https://test.com/static/recorder-v2.js?v=v0.0.1',
                expect.anything()
            )
        })

        it('loads script after `startCaptureAndTrySendingQueuedSnapshots` if not previously loaded', () => {
            session_recording_enabled_server_side = false

            sessionRecording.startRecordingIfEnabled()
            expect(loadScript).not.toHaveBeenCalled()

            sessionRecording.startCaptureAndTrySendingQueuedSnapshots()

            expect(loadScript).toHaveBeenCalled()
        })

        it('does not load script if disable_session_recording passed', () => {
            posthog.config.disable_session_recording = true

            sessionRecording.startRecordingIfEnabled()
            sessionRecording.startCaptureAndTrySendingQueuedSnapshots()

            expect(loadScript).not.toHaveBeenCalled()
        })

        it('session recording can be turned on and off', () => {
            expect(sessionRecording.stopRrweb).toEqual(undefined)

            sessionRecording.startRecordingIfEnabled()

            expect(sessionRecording.started()).toEqual(true)
            expect(sessionRecording.captureStarted).toEqual(true)
            expect(sessionRecording.stopRrweb).not.toEqual(undefined)

            sessionRecording.stopRecording()

            expect(sessionRecording.stopRrweb).toEqual(undefined)
            expect(sessionRecording.captureStarted).toEqual(false)
        })

        it('session recording can be turned on after being turned off', () => {
            expect(sessionRecording.stopRrweb).toEqual(undefined)

            sessionRecording.startRecordingIfEnabled()

            expect(sessionRecording.started()).toEqual(true)
            expect(sessionRecording.captureStarted).toEqual(true)
            expect(sessionRecording.stopRrweb).not.toEqual(undefined)

            sessionRecording.stopRecording()

            expect(sessionRecording.stopRrweb).toEqual(undefined)
            expect(sessionRecording.captureStarted).toEqual(false)
        })

        describe('console logs', () => {
            it('if not enabled, plugin is not used', () => {
                posthog.config.enable_recording_console_log = false

                sessionRecording.startRecordingIfEnabled()

                expect(window.rrwebConsoleRecord.getRecordConsolePlugin).not.toHaveBeenCalled()
            })

            it('if enabled, plugin is used', () => {
                posthog.config.enable_recording_console_log = true

                sessionRecording.startRecordingIfEnabled()

                expect(window.rrwebConsoleRecord.getRecordConsolePlugin).toHaveBeenCalled()
            })
        })

        describe('session and window ids', () => {
            beforeEach(() => {
                sessionRecording.sessionId = 'old-session-id'
                sessionRecording.windowId = 'old-window-id'

                sessionRecording.startRecordingIfEnabled()
                sessionRecording.startCaptureAndTrySendingQueuedSnapshots()
            })

            it('sends a full snapshot if there is a new session/window id and the event is not type FullSnapshot or Meta', () => {
                sessionManager.checkAndGetSessionAndWindowId.mockImplementation(() => ({
                    sessionId: 'new-session-id',
                    windowId: 'new-window-id',
                }))
                _emit(createIncrementalSnapshot())
                expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalled()
            })

            it('sends a full snapshot if there is a new window id and the event is not type FullSnapshot or Meta', () => {
                sessionManager.checkAndGetSessionAndWindowId.mockImplementation(() => ({
                    sessionId: 'old-session-id',
                    windowId: 'new-window-id',
                }))
                _emit(createIncrementalSnapshot())
                expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalled()
            })

            it('does not send a full snapshot if there is a new session/window id and the event is type FullSnapshot or Meta', () => {
                sessionManager.checkAndGetSessionAndWindowId.mockImplementation(() => ({
                    sessionId: 'new-session-id',
                    windowId: 'new-window-id',
                }))
                _emit(createIncrementalSnapshot({ type: META_EVENT_TYPE }))
                expect(window.rrwebRecord.takeFullSnapshot).not.toHaveBeenCalled()
            })

            it('does not send a full snapshot if there is not a new session or window id', () => {
                sessionManager.checkAndGetSessionAndWindowId.mockImplementation(() => ({
                    sessionId: 'old-session-id',
                    windowId: 'old-window-id',
                }))
                _emit(createIncrementalSnapshot())
                expect(window.rrwebRecord.takeFullSnapshot).not.toHaveBeenCalled()
            })

            it('it calls checkAndGetSessionAndWindowId with readOnly as true if it not a user interaction', () => {
                _emit(createIncrementalSnapshot({ data: { source: MUTATION_SOURCE_TYPE, adds: [{ id: 1 }] } }))
                expect(posthog.sessionManager.checkAndGetSessionAndWindowId).toHaveBeenCalledWith(true, undefined)
            })

            it('it calls checkAndGetSessionAndWindowId with readOnly as false if it is a user interaction', () => {
                _emit(createIncrementalSnapshot())
                expect(posthog.sessionManager.checkAndGetSessionAndWindowId).toHaveBeenCalledWith(false, undefined)
            })
        })

        describe('the session id manager', () => {
            const startingDate = new Date()

            const emitAtDateTime = (date, source = 1) =>
                _emit({
                    event: 123,
                    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                    timestamp: date.getTime(),
                    data: {
                        source,
                    },
                })

            describe('onSessionId Callbacks', () => {
                let mockCallback
                let unsubscribeCallback

                beforeEach(() => {
                    sessionManager = new SessionIdManager(config, new PostHogPersistence(config))
                    posthog.sessionManager = sessionManager

                    mockCallback = jest.fn()
                    unsubscribeCallback = sessionManager.onSessionId(mockCallback)

                    expect(mockCallback).not.toHaveBeenCalled()

                    sessionRecording.startRecordingIfEnabled()
                    sessionRecording.startCaptureAndTrySendingQueuedSnapshots()

                    expect(mockCallback).toHaveBeenCalledTimes(1)
                })

                it('calls the callback when the session id changes', () => {
                    const startingSessionId = sessionManager._getSessionId()[1]
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

                    expect(sessionManager._getSessionId()[1]).not.toEqual(startingSessionId)

                    expect(mockCallback).toHaveBeenCalledTimes(2)
                    // last call received the new session id
                    expect(mockCallback.mock.calls[1][0]).toEqual(sessionManager._getSessionId()[1])
                })

                it('does not calls the callback when the session id changes after unsubscribe', () => {
                    unsubscribeCallback()

                    const startingSessionId = sessionManager._getSessionId()[1]
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

                    expect(sessionManager._getSessionId()[1]).not.toEqual(startingSessionId)

                    expect(mockCallback).toHaveBeenCalledTimes(1)
                    // the only call received the original session id
                    expect(mockCallback.mock.calls[0][0]).toEqual(startingSessionId)
                })
            })

            describe('with a real session id manager', () => {
                beforeEach(() => {
                    sessionManager = new SessionIdManager(config, new PostHogPersistence(config))
                    posthog.sessionManager = sessionManager

                    sessionRecording.startRecordingIfEnabled()
                    sessionRecording.startCaptureAndTrySendingQueuedSnapshots()
                })

                it('takes a full snapshot for the first _emit', () => {
                    emitAtDateTime(startingDate)
                    expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalledTimes(1)
                })

                it('does not take a full snapshot for the second _emit', () => {
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
                    expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalledTimes(1)
                })

                it('does not change session id for a second _emit', () => {
                    const startingSessionId = sessionManager._getSessionId()[1]

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

                    expect(sessionManager._getSessionId()[1]).toEqual(startingSessionId)
                })

                it('does not take a full snapshot for the third _emit', () => {
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

                    emitAtDateTime(
                        new Date(
                            startingDate.getFullYear(),
                            startingDate.getMonth(),
                            startingDate.getDate(),
                            startingDate.getHours(),
                            startingDate.getMinutes() + 2
                        )
                    )
                    expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalledTimes(1)
                })

                it('sends a full snapshot if the session is rotated because session has been inactive for 30 minutes', () => {
                    const startingSessionId = sessionManager._getSessionId()[1]
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

                    expect(sessionManager._getSessionId()[1]).not.toEqual(startingSessionId)
                    expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalledTimes(2)
                })

                it('sends a full snapshot if the session is rotated because max time has passed', () => {
                    const startingSessionId = sessionManager._getSessionId()[1]
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

                    expect(sessionManager._getSessionId()[1]).not.toEqual(startingSessionId)
                    expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalledTimes(2)
                })
            })

            describe('idle timeouts', () => {
                it("enters idle state if the activity is non-user generated and there's no activity for 5 seconds", () => {
                    sessionRecording.startRecordingIfEnabled()
                    const lastActivityTimestamp = sessionRecording.lastActivityTimestamp
                    expect(lastActivityTimestamp).toBeGreaterThan(0)

                    expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalledTimes(0)

                    _emit({
                        event: 123,
                        type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                        data: {
                            source: 1,
                        },
                        timestamp: lastActivityTimestamp + 100,
                    })
                    expect(sessionRecording.isIdle).toEqual(false)
                    expect(sessionRecording.lastActivityTimestamp).toEqual(lastActivityTimestamp + 100)

                    expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalledTimes(1)

                    _emit({
                        event: 123,
                        type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                        data: {
                            source: 0,
                        },
                        timestamp: lastActivityTimestamp + 200,
                    })
                    expect(sessionRecording.isIdle).toEqual(false)
                    expect(sessionRecording.lastActivityTimestamp).toEqual(lastActivityTimestamp + 100)

                    _emit({
                        event: 123,
                        type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                        data: {
                            source: 0,
                        },
                        timestamp: lastActivityTimestamp + RECORDING_IDLE_ACTIVITY_TIMEOUT_MS + 1000,
                    })
                    expect(sessionRecording.isIdle).toEqual(true)
                    expect(sessionRecording.lastActivityTimestamp).toEqual(lastActivityTimestamp + 100)
                    expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalledTimes(1)

                    _emit({
                        event: 123,
                        type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                        data: {
                            source: 1,
                        },
                        timestamp: lastActivityTimestamp + RECORDING_IDLE_ACTIVITY_TIMEOUT_MS + 2000,
                    })
                    expect(sessionRecording.isIdle).toEqual(false)
                    expect(sessionRecording.lastActivityTimestamp).toEqual(
                        lastActivityTimestamp + RECORDING_IDLE_ACTIVITY_TIMEOUT_MS + 2000
                    )
                    expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalledTimes(2)
                })
            })
        })
    })
})
