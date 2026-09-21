import { replayOptions } from '../../../extensions/replay/replay-options'
import { createMockConfig, createMockPostHog } from '../../helpers/posthog-instance'

describe('replay options adapter', () => {
    it('maps browser settings and retains recording callbacks and option objects', () => {
        const recording = { maskAllInputs: false, maskTextFn: vi.fn((text: string) => text) }
        const personalDataQueryParams = ['custom-secret']
        const config = createMockConfig({
            session_recording: recording,
            disable_session_recording: true,
            enable_recording_console_log: true,
            capture_performance: { network_timing: false, web_vitals: true },
            api_host: 'https://test.com',
            capture_pageview: 'history_change',
            disable_capture_url_hashes: true,
            mask_personal_data_properties: true,
            custom_personal_data_properties: personalDataQueryParams,
        })
        const result = replayOptions(createMockPostHog({ config }))

        expect(result).toEqual({
            recording,
            disabled: true,
            consoleLogRecordingEnabled: true,
            networkTiming: false,
            apiHost: 'https://test.com',
            capturePageview: true,
            stripUrlHash: true,
            maskPersonalData: true,
            personalDataQueryParams,
        })
        expect(result.recording).toBe(config.session_recording)
        expect(result.recording.maskTextFn).toBe(recording.maskTextFn)
        expect(result.personalDataQueryParams).toBe(personalDataQueryParams)
    })

    it('reads live browser configuration on each call', () => {
        const posthog = createMockPostHog({ config: createMockConfig() })
        replayOptions(posthog)
        const recording = { maskAllInputs: true }
        posthog.config.session_recording = recording
        posthog.config.capture_performance = true
        posthog.config.capture_pageview = false
        posthog.config.disable_session_recording = true

        expect(replayOptions(posthog)).toMatchObject({
            recording,
            networkTiming: true,
            capturePageview: false,
            disabled: true,
        })
        expect(replayOptions(posthog).recording).toBe(recording)
    })
})
