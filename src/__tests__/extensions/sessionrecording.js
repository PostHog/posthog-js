import { loadScript } from '../../autocapture-utils'
import {
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
    MUTATION_SOURCE_TYPE,
    SessionRecording,
} from '../../extensions/sessionrecording'
import { SESSION_RECORDING_ENABLED_SERVER_SIDE } from '../../posthog-persistence'

jest.mock('../../autocapture-utils')
jest.mock('../../config', () => ({ LIB_VERSION: 'v0.0.1' }))

describe('SessionRecording', () => {
    let _emit

    given('sessionRecording', () => new SessionRecording(given.posthog))
    given('incomingSessionAndWindowId', () => ({ sessionId: 'sessionId', windowId: 'windowId' }))

    given('posthog', () => ({
        get_property: () => given.$session_recording_enabled_server_side,
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        capture: jest.fn(),
        persistence: { register: jest.fn() },
        _captureMetrics: { incr: jest.fn() },
        sessionManager: {
            getSessionAndWindowId: jest.fn().mockImplementation(() => given.incomingSessionAndWindowId),
        },
        _addCaptureHook: jest.fn(),
    }))

    given('config', () => ({
        api_host: 'https://test.com',
        disable_session_recording: given.disabled,
        autocapture: false, // Assert that session recording works even if `autocapture = false`
        session_recording: {
            maskAllInputs: true,
            recordCanvas: true,
            someUnregisteredProp: 'abc',
        },
    }))
    given('$session_recording_enabled_server_side', () => true)
    given('disabled', () => false)

    beforeEach(() => {
        window.rrweb = {
            record: jest.fn(),
        }
    })

    describe('isRecordingEnabled', () => {
        given('subject', () => () => given.sessionRecording.isRecordingEnabled())
        it('is enabled id both the server and client config says enabled', () => {
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
            window.rrweb = {
                record: jest.fn(({ emit }) => {
                    _emit = emit
                    return () => {}
                }),
            }
            window.rrweb.record.takeFullSnapshot = mockFullSnapshot
            loadScript.mockImplementation((path, callback) => callback())
        })

        it('calls rrweb.record with the right options', () => {
            given.sessionRecording._onScriptLoaded()

            // maskAllInputs should change from default
            // someUnregisteredProp should not be present
            expect(window.rrweb.record).toHaveBeenCalledWith({
                emit: expect.anything(),
                maskAllInputs: true,
                blockClass: 'ph-no-capture',
                blockSelector: null,
                ignoreClass: 'ph-ignore-input',
                maskInputOptions: {},
                maskInputFn: null,
                slimDOMOptions: {},
                collectFonts: false,
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
                    _forceCompression: true,
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
                    _forceCompression: true,
                    _noTruncate: true,
                    _batchKey: 'sessionRecording',
                    _metrics: expect.anything(),
                }
            )
        })

        it('loads recording script from right place', () => {
            given.sessionRecording.startRecordingIfEnabled()

            expect(loadScript).toHaveBeenCalledWith('https://test.com/static/recorder.js?v=v0.0.1', expect.anything())
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
            expect(given.sessionRecording.stopRrweb).toEqual(null)

            given.sessionRecording.startRecordingIfEnabled()

            expect(given.sessionRecording.started()).toEqual(true)
            expect(given.sessionRecording.captureStarted).toEqual(true)
            expect(given.sessionRecording.stopRrweb).not.toEqual(null)

            given.sessionRecording.stopRecording()

            expect(given.sessionRecording.stopRrweb).toEqual(null)
            expect(given.sessionRecording.captureStarted).toEqual(false)
        })

        it('session recording can be turned on after being turned off', () => {
            expect(given.sessionRecording.stopRrweb).toEqual(null)

            given.sessionRecording.startRecordingIfEnabled()

            expect(given.sessionRecording.started()).toEqual(true)
            expect(given.sessionRecording.captureStarted).toEqual(true)
            expect(given.sessionRecording.stopRrweb).not.toEqual(null)

            given.sessionRecording.stopRecording()

            expect(given.sessionRecording.stopRrweb).toEqual(null)
            expect(given.sessionRecording.captureStarted).toEqual(false)
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
                expect(window.rrweb.record.takeFullSnapshot).toHaveBeenCalled()
            })

            it('sends a full snapshot if there is a new window id and the event is not type FullSnapshot or Meta', () => {
                given('incomingSessionAndWindowId', () => ({ sessionId: 'old-session-id', windowId: 'new-window-id' }))
                _emit({ event: 123, type: INCREMENTAL_SNAPSHOT_EVENT_TYPE })
                expect(window.rrweb.record.takeFullSnapshot).toHaveBeenCalled()
            })

            it('does not send a full snapshot if there is a new session/window id and the event is type FullSnapshot or Meta', () => {
                given('incomingSessionAndWindowId', () => ({ sessionId: 'new-session-id', windowId: 'new-window-id' }))
                _emit({ event: 123, type: META_EVENT_TYPE })
                expect(window.rrweb.record.takeFullSnapshot).not.toHaveBeenCalled()
            })

            it('does not send a full snapshot if there is not a new session or window id', () => {
                given('incomingSessionAndWindowId', () => ({ sessionId: 'old-session-id', windowId: 'old-window-id' }))
                _emit({ event: 123, type: INCREMENTAL_SNAPSHOT_EVENT_TYPE })
                expect(window.rrweb.record.takeFullSnapshot).not.toHaveBeenCalled()
            })

            it('it uses the current timestamp if the event does not have one', () => {
                const mockDate = new Date(1602107460000)
                jest.spyOn(global, 'Date').mockImplementation(() => mockDate)
                _emit({ event: 123, type: INCREMENTAL_SNAPSHOT_EVENT_TYPE })
                expect(given.posthog.sessionManager.getSessionAndWindowId).toHaveBeenCalledWith(1602107460000, {
                    event: 123,
                    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                })
            })

            it('sends its timestamp and event data to getSessionAndWindowId', () => {
                _emit({
                    event: 123,
                    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                    data: { source: MUTATION_SOURCE_TYPE },
                    timestamp: 1602107460000,
                })
                expect(given.posthog.sessionManager.getSessionAndWindowId).toHaveBeenCalledWith(1602107460000, {
                    event: 123,
                    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                    data: { source: MUTATION_SOURCE_TYPE },
                    timestamp: 1602107460000,
                })
            })
        })
    })
})
