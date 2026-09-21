import type { ReplayOptions } from '../../../src/replay/host'

export function createReplayOptions(): ReplayOptions {
    return {
        recording: {},
        disabled: false,
        apiHost: 'https://us.i.posthog.com',
        capturePageview: true,
        stripUrlHash: false,
        maskPersonalData: false,
    }
}
