import { loadScript } from '../../autocapture-utils'
import { SessionRecording } from '../../extensions/sessionrecording'
import { SESSION_RECORDING_ENABLED } from '../../posthog-persistence'
import sessionIdGenerator from '../../extensions/sessionid'

jest.mock('../../autocapture-utils')
jest.mock('../../extensions/sessionid')
jest.mock('../../config', () => ({ LIB_VERSION: 'v0.0.1' }))

describe('SessionRecording', () => {
    let _emit

    given('sessionRecording', () => new SessionRecording(given.posthog))

    given('posthog', () => ({
        get_property: () => given.$session_recording_enabled,
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        capture: jest.fn(),
        persistence: { register: jest.fn() },
        _captureMetrics: { incr: jest.fn() },
        _addCaptureHook: jest.fn(),
    }))

    given('config', () => ({
        api_host: 'https://test.com',
        disable_session_recording: given.disabled,
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
    })

    describe('recording', () => {
        given('disabled', () => false)
        given('$session_recording_enabled', () => true)

        beforeEach(() => {
            window.rrweb = {
                record: jest.fn(({ emit }) => {
                    _emit = emit
                }),
            }

            loadScript.mockImplementation((path, callback) => callback())
            sessionIdGenerator.mockReturnValue('sid')
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
                    $session_id: 'sid',
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
                    $session_id: 'sid',
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
    })
})
