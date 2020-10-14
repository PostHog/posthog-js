import { loadScript } from '../autocapture-utils'
import { PosthogSessionRecording } from '../posthog-sessionrecording'

jest.mock('../autocapture-utils')

describe('Session recording system', () => {
    let _emit

    given('sessionRecording', () => new PosthogSessionRecording(given.posthog))
    given('posthog', () => ({
        disable_session_recording: given.disabled,
        persistence: { props: { $session_recording_enabled: given.$session_recording_enabled } },
        get_config: () => 'posthog.example.com',
        capture: jest.fn(),
    }))

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
        given.sessionRecording._init()
        expect(loadScript).toHaveBeenCalled()

        _emit({ event: 1 })
        expect(given.posthog.capture).not.toHaveBeenCalled()

        given.sessionRecording.recordAndSubmit()
        _emit({ event: 2 })

        expect(given.posthog.capture).toHaveBeenCalledTimes(2)
        expect(given.posthog.capture).toHaveBeenCalledWith('$snapshot', { $snapshot_data: { event: 1 } })
        expect(given.posthog.capture).toHaveBeenCalledWith('$snapshot', { $snapshot_data: { event: 2 } })
    })

    it('loads recording script from right place', () => {
        given.sessionRecording._init()

        expect(loadScript).toHaveBeenCalledWith('posthog.example.com/static/recorder.js', expect.anything())
    })

    it('loads script after `recordAndSubmit` if not previously loaded', () => {
        given('$session_recording_enabled', () => false)

        given.sessionRecording._init()
        expect(loadScript).not.toHaveBeenCalled()

        given.sessionRecording.recordAndSubmit()

        expect(loadScript).toHaveBeenCalled()
    })

    it('does not load script if disable_session_recording passed', () => {
        given('disabled', () => true)

        given.sessionRecording._init()
        given.sessionRecording.recordAndSubmit()

        expect(loadScript).not.toHaveBeenCalled()
    })
})
