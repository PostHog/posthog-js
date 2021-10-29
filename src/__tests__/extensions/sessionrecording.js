import { loadScript } from '../../autocapture-utils'
import {
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
    MUTATION_SOURCE_TYPE,
    SessionRecording,
} from '../../extensions/sessionrecording'
import { SESSION_RECORDING_ENABLED } from '../../posthog-persistence'

jest.mock('../../autocapture-utils')
jest.mock('../../config', () => ({ LIB_VERSION: 'v0.0.1' }))

describe('SessionRecording', () => {
    let _emit

    given('sessionRecording', () => new SessionRecording(given.posthog))
    given('incomingSessionAndWindowId', () => ({ sessionId: 'sessionId', windowId: 'windowId' }))

    given('posthog', () => ({
        get_property: () => given.$session_recording_enabled,
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        capture: jest.fn(),
        persistence: { register: jest.fn() },
        _captureMetrics: { incr: jest.fn() },
        _sessionIdManager: {
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

    beforeEach(() => {
        window.rrweb = {
            record: jest.fn(),
        }
    })

    describe('afterDecideResponse()', () => {
        given('subject', () => () => given.sessionRecording.afterDecideResponse(given.response))

        beforeEach(() => {
            jest.spyOn(given.sessionRecording, 'submitRecordings')
        })

        it('starts session recording, saves setting when enabled', () => {
            given('response', () => ({ sessionRecording: true }))

            given.subject()

            expect(given.sessionRecording.submitRecordings).toHaveBeenCalled()
            expect(given.posthog.persistence.register).toHaveBeenCalledWith({ [SESSION_RECORDING_ENABLED]: true })
        })

        it('starts session recording, saves setting and endpoint when enabled', () => {
            given('response', () => ({ sessionRecording: { endpoint: '/ses/' } }))

            given.subject()

            expect(given.sessionRecording.submitRecordings).toHaveBeenCalled()
            expect(given.posthog.persistence.register).toHaveBeenCalledWith({ [SESSION_RECORDING_ENABLED]: true })
            expect(given.sessionRecording.endpoint).toEqual('/ses/')
        })

        it('does not start recording if not allowed', () => {
            given('response', () => ({}))

            given.subject()

            expect(given.sessionRecording.submitRecordings).not.toHaveBeenCalled()
            expect(given.posthog.persistence.register).toHaveBeenCalledWith({ [SESSION_RECORDING_ENABLED]: false })
        })

        it('does not start session recording if enabled via server but not client', () => {
            given('response', () => ({ sessionRecording: { endpoint: '/ses/' } }))
            given('disabled', () => true)
            given.subject()

            expect(given.sessionRecording.submitRecordings).not.toHaveBeenCalled()
            expect(given.posthog.persistence.register).toHaveBeenCalledWith({ [SESSION_RECORDING_ENABLED]: false })
        })
    })

    describe('recording', () => {
        given('disabled', () => false)
        given('$session_recording_enabled', () => true)

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

            given.sessionRecording.submitRecordings()
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

        it('loads script after `submitRecordings` if not previously loaded', () => {
            given('$session_recording_enabled', () => false)

            given.sessionRecording.startRecordingIfEnabled()
            expect(loadScript).not.toHaveBeenCalled()

            given.sessionRecording.submitRecordings()

            expect(loadScript).toHaveBeenCalled()
        })

        it('does not load script if disable_session_recording passed', () => {
            given('disabled', () => true)

            given.sessionRecording.startRecordingIfEnabled()
            given.sessionRecording.submitRecordings()

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

        describe('session and window ids', () => {
            beforeEach(() => {
                given.sessionRecording.sessionId = 'old-session-id'
                given.sessionRecording.windowId = 'old-window-id'

                given.sessionRecording.startRecordingIfEnabled()
                given.sessionRecording.submitRecordings()
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
                expect(given.posthog._sessionIdManager.getSessionAndWindowId).toHaveBeenCalledWith(
                    new Date(1602107460000),
                    { event: 123, type: INCREMENTAL_SNAPSHOT_EVENT_TYPE }
                )
            })

            it('sends its timestamp and event data to getSessionAndWindowId', () => {
                _emit({
                    event: 123,
                    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                    data: { source: MUTATION_SOURCE_TYPE },
                    timestamp: 1602107460000,
                })
                expect(given.posthog._sessionIdManager.getSessionAndWindowId).toHaveBeenCalledWith(1602107460000, {
                    event: 123,
                    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                    data: { source: MUTATION_SOURCE_TYPE },
                    timestamp: 1602107460000,
                })
            })
        })
    })
})
