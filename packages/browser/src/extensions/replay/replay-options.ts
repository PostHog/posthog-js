import type { ReplayOptions } from '@posthog/browser-common/replay/host'
import { isObject } from '@posthog/core'
import type { PostHogConfig } from '../../types'
import type { PostHog } from '../../posthog-core'

export function replayOptions(instance: PostHog): ReplayOptions {
    return replayOptionsFromConfig(instance.config)
}

export function replayOptionsFromConfig(config: PostHogConfig): ReplayOptions {
    return {
        recording: config.session_recording,
        disabled: config.disable_session_recording,
        consoleLogRecordingEnabled: config.enable_recording_console_log,
        networkTiming: isObject(config.capture_performance)
            ? config.capture_performance.network_timing
            : config.capture_performance,
        apiHost: config.api_host,
        capturePageview: !!config.capture_pageview,
        stripUrlHash: config.disable_capture_url_hashes,
        maskPersonalData: config.mask_personal_data_properties,
        personalDataQueryParams: config.custom_personal_data_properties,
    }
}
