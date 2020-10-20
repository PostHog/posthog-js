import { loadScript } from '../../autocapture-utils'
import { SessionRecording } from '../../extensions/sessionrecording'
import { SESSION_RECORDING_ENABLED } from '../../posthog-persistence'

jest.mock('../../autocapture-utils')

describe('SessionRecording', () => {
    let _emit

    given('sessionRecording', () => new SessionRecording(given.posthog))
    given('posthog', () => ({
        disable_session_recording: given.disabled,
        get_property: () => given.$session_recording_enabled,
        get_config: () => 'posthog.example.com',
        capture: jest.fn(),
        persistence: { register: jest.fn() },
    }))

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
                record: function ({ emit }) {
                    _emit = emit
                },
            }

            loadScript.mockImplementation((path, callback) => callback())
        })

        it('records events emitted before and after starting recording', () => {
            given.sessionRecording.startRecordingIfEnabled()
            expect(loadScript).toHaveBeenCalled()

            _emit({ event: 1 })
            expect(given.posthog.capture).not.toHaveBeenCalled()

            given.sessionRecording.submitRecordings()
            _emit({ event: 2 })

            expect(given.posthog.capture).toHaveBeenCalledTimes(2)
            expect(given.posthog.capture).toHaveBeenCalledWith('$snapshot', { $snapshot_data: { event: 1 } })
            expect(given.posthog.capture).toHaveBeenCalledWith('$snapshot', { $snapshot_data: { event: 2 } })
        })

        it('loads recording script from right place', () => {
            given.sessionRecording.startRecordingIfEnabled()

            expect(loadScript).toHaveBeenCalledWith('posthog.example.com/static/recorder.js', expect.anything())
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
