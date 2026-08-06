import Config from '../config'
import { SDK_DIST_CHANNEL } from '@posthog/browser-common/constants'
import { init_as_module, init_from_snippet } from '../posthog-core'
import { getEventProperties } from '@posthog/browser-common/utils/event-utils'
import { assignableWindow } from '../utils/globals'

describe('sdk dist channel', () => {
    afterEach(() => {
        Config.SDK_DIST_CHANNEL = undefined
        assignableWindow.posthog = undefined as any
    })

    it.each([
        ['before an entrypoint sets it', undefined],
        ['when empty', ''],
    ])('does not report dist channel %s', (_, sdkDistChannel) => {
        ;(Config as any).SDK_DIST_CHANNEL = sdkDistChannel

        expect(getEventProperties()).not.toHaveProperty(SDK_DIST_CHANNEL)
    })

    it('overrides a prior dist channel and reports npm for module usage', () => {
        Config.SDK_DIST_CHANNEL = 'cdn'

        init_as_module()

        expect(getEventProperties()[SDK_DIST_CHANNEL]).toBe('npm')
    })

    it('reports cdn for snippet usage', () => {
        assignableWindow.posthog = { _i: [] } as any

        init_from_snippet()

        expect(getEventProperties()[SDK_DIST_CHANNEL]).toBe('cdn')
    })
})
