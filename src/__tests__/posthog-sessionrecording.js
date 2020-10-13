import 'given2/setup'
import sinon from 'sinon'

import * as utils from '../autocapture-utils'
import { PosthogSessionRecording } from '../posthog-sessionrecording'

describe('Session recording system', () => {
    let _emit
    let sandbox

    given('sessionRecording', () => new PosthogSessionRecording(given.posthog))
    given('posthog', () => ({
        disable_session_recording: given.disabled,
        persistence: { props: { $session_recording_enabled: given.$session_recording_enabled } },
        get_config: () => 'posthog.example.com',
        capture: sinon.spy(),
    }))

    given('disabled', () => false)
    given('$session_recording_enabled', () => true)

    beforeEach(() => {
        window.rrweb = {
            record: function ({ emit }) {
                _emit = emit
            },
        }
        sandbox = sinon.createSandbox()
        sandbox.stub(utils, 'loadScript').callsFake((path, callback) => callback())
    })

    afterEach(() => {
        sandbox.restore()
    })

    it('records events emitted before and after starting recording', () => {
        given.sessionRecording._init()
        expect(utils.loadScript.calledOnce).toBe(true)

        _emit({ event: 1 })
        expect(given.posthog.capture.notCalled).toBe(true)

        given.sessionRecording.recordAndSubmit()
        _emit({ event: 2 })

        expect(given.posthog.capture.calledTwice).toBe(true)
        expect(given.posthog.capture.calledWith('$snapshot', { $snapshot_data: { event: 1 } })).toBe(true)
        expect(given.posthog.capture.calledWith('$snapshot', { $snapshot_data: { event: 2 } })).toBe(true)
    })

    it('loads recording script from right place', () => {
        given.sessionRecording._init()

        expect(utils.loadScript.calledWith('posthog.example.com/static/recorder.js')).toBe(true)
    })

    it('loads script after `recordAndSubmit` if not previously loaded', () => {
        given('$session_recording_enabled', () => false)

        given.sessionRecording._init()
        expect(utils.loadScript.notCalled).toBe(true)

        given.sessionRecording.recordAndSubmit()

        expect(utils.loadScript.called).toBe(true)
    })

    it('does not load script if disable_session_recording passed', () => {
        given('disabled', () => true)

        given.sessionRecording._init()
        given.sessionRecording.recordAndSubmit()

        expect(utils.loadScript.notCalled).toBe(true)
    })
})
