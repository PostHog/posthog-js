import { loadScript } from '../../autocapture-utils'
import { SessionRecording } from '../../extensions/sessionrecording'
import {
    PostHogPersistence,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE,
} from '../../posthog-persistence'
import { SessionIdManager } from '../../sessionid'
import {
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
    MUTATION_SOURCE_TYPE,
} from '../../extensions/sessionrecording-utils'

// Type and source defined here designate a non-user-generated recording event
const NON_USER_GENERATED_EVENT = { type: INCREMENTAL_SNAPSHOT_EVENT_TYPE, data: { source: MUTATION_SOURCE_TYPE } }

jest.mock('../../autocapture-utils')
jest.mock('../../config', () => ({ LIB_VERSION: 'v0.0.1' }))

describe('SessionRecording', () => {
    let _emit

    given('sessionRecording', () => new SessionRecording(given.posthog))
    given('incomingSessionAndWindowId', () => ({ sessionId: 'sessionId', windowId: 'windowId' }))

    given('sessionManager', () => ({
        checkAndGetSessionAndWindowId: jest.fn().mockImplementation(() => given.incomingSessionAndWindowId),
    }))
    given('posthog', () => ({
        get_property: (property_key) =>
            property_key === SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE
                ? given.$session_recording_recorder_version_server_side
                : property_key === SESSION_RECORDING_ENABLED_SERVER_SIDE
                ? given.$session_recording_enabled_server_side
                : given.$console_log_enabled_server_side,
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        capture: jest.fn(),
        persistence: { register: jest.fn() },
        _captureMetrics: { incr: jest.fn() },
        sessionManager: given.sessionManager,
        _addCaptureHook: jest.fn(),
        __loaded_recorder_version: given.__loaded_recorder_version,
    }))

    given('config', () => ({
        api_host: 'https://test.com',
        disable_session_recording: given.disabled,
        enable_recording_console_log: given.enable_recording_console_log_client_side,
        autocapture: false, // Assert that session recording works even if `autocapture = false`
        session_recording: {
            maskAllInputs: false,
            someUnregisteredProp: 'abc',
            recorderVersion: given.recorder_version_client_side,
        },
        persistence: 'memory',
    }))
    given('$session_recording_enabled_server_side', () => true)
    given('$console_log_enabled_server_side', () => false)
    given('$session_recording_recorder_version_server_side', () => undefined)
    given('disabled', () => false)
    given('__loaded_recorder_version', () => undefined)

    beforeEach(() => {
        window.rrwebRecord = jest.fn()
        window.rrwebConsoleRecord = { getRecordConsolePlugin: jest.fn() }
    })

    describe('isRecordingEnabled', () => {
        given('subject', () => () => given.sessionRecording.isRecordingEnabled())
        it('is enabled if both the server and client config says enabled', () => {
            given.subject()
            expect(given.subject()).toBe(true)
        })

        it('is disabled if the server is disabled', () => {
            given('$session_recording_enabled_server_side', () => false)
            given.subject()
            expect(given.subject()).toBe(false)
        })

        it('is disabled if the client config is disabled', () => {
            given('disabled', () => true)
            given.subject()
            expect(given.subject()).toBe(false)
        })
    })

    describe('isConsoleLogCaptureEnabled', () => {
        given('subject', () => () => given.sessionRecording.isConsoleLogCaptureEnabled())
        it('uses client side setting when set to false', () => {
            given('$console_log_enabled_server_side', () => true)
            given('enable_recording_console_log_client_side', () => false)
            expect(given.subject()).toBe(false)
        })

        it('uses client side setting when set to true', () => {
            given('$console_log_enabled_server_side', () => false)
            given('enable_recording_console_log_client_side', () => true)
            expect(given.subject()).toBe(true)
        })

        it('uses server side setting if client side setting is not set', () => {
            given('enable_recording_console_log_client_side', () => undefined)

            given('$console_log_enabled_server_side', () => false)
            expect(given.subject()).toBe(false)

            given('$console_log_enabled_server_side', () => true)
            expect(given.subject()).toBe(true)
        })
    })

    describe('getRecordingVersion', () => {
        given('subject', () => () => given.sessionRecording.getRecordingVersion())

        it('uses client side setting v2 over server side', () => {
            given('$session_recording_recorder_version_server_side', () => 'v1')
            given('recorder_version_client_side', () => 'v2')
            expect(given.subject()).toBe('v2')
        })

        it('uses client side setting v1 over server side', () => {
            given('$session_recording_recorder_version_server_side', () => 'v2')
            given('recorder_version_client_side', () => 'v1')
            expect(given.subject()).toBe('v1')
        })

        it('uses server side setting if client side setting is not set', () => {
            given('recorder_version_client_side', () => undefined)

            given('$session_recording_recorder_version_server_side', () => 'v1')
            expect(given.subject()).toBe('v1')

            given('$session_recording_recorder_version_server_side', () => 'v2')
            expect(given.subject()).toBe('v2')

            given('$session_recording_recorder_version_server_side', () => undefined)
            expect(given.subject()).toBe('v1')
        })
    })

    describe('startRecordingIfEnabled', () => {
        given('subject', () => () => given.sessionRecording.startRecordingIfEnabled())

        beforeEach(() => {
            jest.spyOn(given.sessionRecording, 'startCaptureAndTrySendingQueuedSnapshots')
            jest.spyOn(given.sessionRecording, 'stopRecording')
        })

        it('call startCaptureAndTrySendingQueuedSnapshots if its enabled', () => {
            given.subject()
            expect(given.sessionRecording.startCaptureAndTrySendingQueuedSnapshots).toHaveBeenCalled()
        })

        it('call stopRecording if its not enabled', () => {
            given('disabled', () => true)
            given.subject()
            expect(given.sessionRecording.stopRecording).toHaveBeenCalled()
        })
    })

    describe('afterDecideResponse()', () => {
        given('subject', () => () => given.sessionRecording.afterDecideResponse(given.response))
        given('response', () => ({ sessionRecording: { endpoint: '/s/' } }))

        beforeEach(() => {
            jest.spyOn(given.sessionRecording, 'startRecordingIfEnabled')

            loadScript.mockImplementation((path, callback) => callback())
        })

        it('emit is not set to true until decide is called', () => {
            given.sessionRecording.startRecordingIfEnabled()
            expect(loadScript).toHaveBeenCalled()
            expect(given.sessionRecording.emit).toBe(false)

            given.subject()
            expect(given.sessionRecording.emit).toBe(true)
        })

        it('stores true in persistence if recording is enabled from the server', () => {
            given.subject()
            expect(given.posthog.persistence.register).toHaveBeenCalledWith({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: true,
            })
        })

        it('stores false in persistence if recording is not enabled from the server', () => {
            given('response', () => ({}))
            given.subject()
            expect(given.posthog.persistence.register).toHaveBeenCalledWith({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: false,
            })
        })

        it('starts session recording, saves setting and endpoint when enabled', () => {
            given('response', () => ({ sessionRecording: { endpoint: '/ses/' } }))

            given.subject()
            expect(given.sessionRecording.startRecordingIfEnabled).toHaveBeenCalled()
            expect(loadScript).toHaveBeenCalled()
            expect(given.posthog.persistence.register).toHaveBeenCalledWith({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: true,
            })
            expect(given.sessionRecording.endpoint).toEqual('/ses/')
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
            given('$console_log_enabled_server_side', () => false)
            given.sessionRecording._onScriptLoaded()

            // maskAllInputs should change from default
            // someUnregisteredProp should not be present
            expect(window.rrwebRecord).toHaveBeenCalledWith({
                emit: expect.anything(),
                maskAllInputs: false,
                blockClass: 'ph-no-capture',
                blockSelector: undefined,
                ignoreClass: 'ph-ignore-input',
                maskInputOptions: {},
                maskInputFn: undefined,
                slimDOMOptions: {},
                collectFonts: false,
                plugins: [],
                inlineStylesheet: true,
            })
        })

        it('records events emitted before and after starting recording', () => {
            given.sessionRecording.startRecordingIfEnabled()
            expect(loadScript).toHaveBeenCalled()

            _emit({ event: 1 })
            expect(given.posthog.capture).not.toHaveBeenCalled()

            given.sessionRecording.afterDecideResponse({ endpoint: '/s/' })
            _emit({ event: 2 })

            expect(given.posthog.capture).toHaveBeenCalledTimes(2)
            expect(given.posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                {
                    $session_id: 'sessionId',
                    $window_id: 'windowId',
                    $snapshot_data: { event: 1 },
                },
                {
                    method: 'POST',
                    transport: 'XHR',
                    endpoint: '/e/',
                    _noTruncate: true,
                    _batchKey: 'sessionRecording',
                    _metrics: expect.anything(),
                }
            )
            expect(given.posthog.capture).toHaveBeenCalledWith(
                '$snapshot',
                {
                    $session_id: 'sessionId',
                    $window_id: 'windowId',
                    $snapshot_data: { event: 2 },
                },
                {
                    method: 'POST',
                    transport: 'XHR',
                    endpoint: '/e/',
                    _noTruncate: true,
                    _batchKey: 'sessionRecording',
                    _metrics: expect.anything(),
                }
            )
        })

        it("doesn't load recording script if already loaded", () => {
            given('__loaded_recorder_version', () => 'v1')
            given.sessionRecording.startRecordingIfEnabled()
            expect(loadScript).not.toHaveBeenCalled()
        })

        it('loads recording v1 script from right place', () => {
            given.sessionRecording.startRecordingIfEnabled()

            expect(loadScript).toHaveBeenCalledWith('https://test.com/static/recorder.js?v=v0.0.1', expect.anything())
        })

        it('loads recording v2 script from right place', () => {
            given('$session_recording_recorder_version_server_side', () => 'v2')
            given.sessionRecording.startRecordingIfEnabled()

            expect(loadScript).toHaveBeenCalledWith(
                'https://test.com/static/recorder-v2.js?v=v0.0.1',
                expect.anything()
            )
        })

        it('do not load recording script again', () => {
            given('__loaded_recorder_version', () => 'v1')
            given('$session_recording_recorder_version_server_side', () => 'v1')
            given.sessionRecording.startRecordingIfEnabled()

            expect(loadScript).not.toHaveBeenCalled()
        })

        it('load correct recording version if there is a cached mismatch', () => {
            given('__loaded_recorder_version', () => 'v1')
            given('$session_recording_recorder_version_server_side', () => 'v2')
            given.sessionRecording.startRecordingIfEnabled()

            expect(loadScript).toHaveBeenCalledWith(
                'https://test.com/static/recorder-v2.js?v=v0.0.1',
                expect.anything()
            )
        })

        it('loads script after `startCaptureAndTrySendingQueuedSnapshots` if not previously loaded', () => {
            given('$session_recording_enabled_server_side', () => false)

            given.sessionRecording.startRecordingIfEnabled()
            expect(loadScript).not.toHaveBeenCalled()

            given.sessionRecording.startCaptureAndTrySendingQueuedSnapshots()

            expect(loadScript).toHaveBeenCalled()
        })

        it('does not load script if disable_session_recording passed', () => {
            given('disabled', () => true)

            given.sessionRecording.startRecordingIfEnabled()
            given.sessionRecording.startCaptureAndTrySendingQueuedSnapshots()

            expect(loadScript).not.toHaveBeenCalled()
        })

        it('session recording can be turned on and off', () => {
            expect(given.sessionRecording.stopRrweb).toEqual(undefined)

            given.sessionRecording.startRecordingIfEnabled()

            expect(given.sessionRecording.started()).toEqual(true)
            expect(given.sessionRecording.captureStarted).toEqual(true)
            expect(given.sessionRecording.stopRrweb).not.toEqual(undefined)

            given.sessionRecording.stopRecording()

            expect(given.sessionRecording.stopRrweb).toEqual(undefined)
            expect(given.sessionRecording.captureStarted).toEqual(false)
        })

        it('session recording can be turned on after being turned off', () => {
            expect(given.sessionRecording.stopRrweb).toEqual(undefined)

            given.sessionRecording.startRecordingIfEnabled()

            expect(given.sessionRecording.started()).toEqual(true)
            expect(given.sessionRecording.captureStarted).toEqual(true)
            expect(given.sessionRecording.stopRrweb).not.toEqual(undefined)

            given.sessionRecording.stopRecording()

            expect(given.sessionRecording.stopRrweb).toEqual(undefined)
            expect(given.sessionRecording.captureStarted).toEqual(false)
        })

        describe('console logs', () => {
            it('if not enabled, plugin is not used', () => {
                given('enable_recording_console_log_client_side', () => false)

                given.sessionRecording.startRecordingIfEnabled()

                expect(window.rrwebConsoleRecord.getRecordConsolePlugin).not.toHaveBeenCalled()
            })

            it('if enabled, plugin is used', () => {
                given('enable_recording_console_log_client_side', () => true)

                given.sessionRecording.startRecordingIfEnabled()

                expect(window.rrwebConsoleRecord.getRecordConsolePlugin).toHaveBeenCalled()
            })
        })

        describe('session and window ids', () => {
            beforeEach(() => {
                given.sessionRecording.sessionId = 'old-session-id'
                given.sessionRecording.windowId = 'old-window-id'

                given.sessionRecording.startRecordingIfEnabled()
                given.sessionRecording.startCaptureAndTrySendingQueuedSnapshots()
            })

            it('sends a full snapshot if there is a new session/window id and the event is not type FullSnapshot or Meta', () => {
                given('incomingSessionAndWindowId', () => ({ sessionId: 'new-session-id', windowId: 'new-window-id' }))
                _emit({ event: 123, type: INCREMENTAL_SNAPSHOT_EVENT_TYPE })
                expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalled()
            })

            it('sends a full snapshot if there is a new window id and the event is not type FullSnapshot or Meta', () => {
                given('incomingSessionAndWindowId', () => ({ sessionId: 'old-session-id', windowId: 'new-window-id' }))
                _emit({ event: 123, type: INCREMENTAL_SNAPSHOT_EVENT_TYPE })
                expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalled()
            })

            it('does not send a full snapshot if there is a new session/window id and the event is type FullSnapshot or Meta', () => {
                given('incomingSessionAndWindowId', () => ({ sessionId: 'new-session-id', windowId: 'new-window-id' }))
                _emit({ event: 123, type: META_EVENT_TYPE })
                expect(window.rrwebRecord.takeFullSnapshot).not.toHaveBeenCalled()
            })

            it('does not send a full snapshot if there is not a new session or window id', () => {
                given('incomingSessionAndWindowId', () => ({ sessionId: 'old-session-id', windowId: 'old-window-id' }))
                _emit({ event: 123, type: INCREMENTAL_SNAPSHOT_EVENT_TYPE })
                expect(window.rrwebRecord.takeFullSnapshot).not.toHaveBeenCalled()
            })

            it('it calls checkAndGetSessionAndWindowId with readOnly as true if it not a user interaction', () => {
                _emit(NON_USER_GENERATED_EVENT)
                expect(given.posthog.sessionManager.checkAndGetSessionAndWindowId).toHaveBeenCalledWith(true, undefined)
            })

            it('it calls checkAndGetSessionAndWindowId with readOnly as false if it is a user interaction', () => {
                _emit({
                    event: 123,
                    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                })
                expect(given.posthog.sessionManager.checkAndGetSessionAndWindowId).toHaveBeenCalledWith(
                    false,
                    undefined
                )
            })
        })

        describe('with a real session id manager', () => {
            const startingDate = new Date()

            beforeEach(() => {
                given('sessionManager', () => new SessionIdManager(given.config, new PostHogPersistence(given.config)))
                given.sessionRecording.startRecordingIfEnabled()
                given.sessionRecording.startCaptureAndTrySendingQueuedSnapshots()
            })

            const emitAtDateTime = (date) =>
                _emit({ event: 123, type: INCREMENTAL_SNAPSHOT_EVENT_TYPE, timestamp: date.getTime() })

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
                const startingSessionId = given.sessionManager._getSessionId()[1]

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

                expect(given.sessionManager._getSessionId()[1]).toEqual(startingSessionId)
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

            it('sends a full snapshot if the session is rotated because session has been inactive for 30 minutess', () => {
                const startingSessionId = given.sessionManager._getSessionId()[1]
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

                expect(given.sessionManager._getSessionId()[1]).not.toEqual(startingSessionId)
                expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalledTimes(2)
            })

            it('sends a full snapshot if the session is rotated because max time has passed', () => {
                const startingSessionId = given.sessionManager._getSessionId()[1]
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

                expect(given.sessionManager._getSessionId()[1]).not.toEqual(startingSessionId)
                expect(window.rrwebRecord.takeFullSnapshot).toHaveBeenCalledTimes(2)
            })
        })
    })
})
