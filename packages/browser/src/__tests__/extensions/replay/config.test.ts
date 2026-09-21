import { defaultConfig } from '../../../posthog-core'
import { buildNetworkRequestOptions } from '../../../extensions/replay/external/config'
import { replayOptionsFromConfig } from '../../../extensions/replay/replay-options'

describe('replay network configuration mapping', () => {
    describe('streamNetworkBody', () => {
        it('defaults to false when no defaults date and no explicit config', () => {
            const config = defaultConfig()
            const networkOptions = buildNetworkRequestOptions(() => replayOptionsFromConfig(config), {})
            expect(networkOptions.streamNetworkBody).toBe(false)
        })

        it('is true when session_recording.streamNetworkBody is set explicitly', () => {
            const config = defaultConfig()
            config.session_recording.streamNetworkBody = true
            const networkOptions = buildNetworkRequestOptions(() => replayOptionsFromConfig(config), {})
            expect(networkOptions.streamNetworkBody).toBe(true)
        })

        it('is true when the 2026-06-25 defaults are applied', () => {
            const config = defaultConfig('2026-06-25')
            const networkOptions = buildNetworkRequestOptions(() => replayOptionsFromConfig(config), {})
            expect(networkOptions.streamNetworkBody).toBe(true)
        })
    })
})
