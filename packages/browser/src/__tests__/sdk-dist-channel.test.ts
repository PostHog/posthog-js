import Config from '../config'
import { SDK_DIST_CHANNEL } from '../constants'
import { init_as_module, init_from_snippet } from '../posthog-core'
import { getEventProperties } from '../utils/event-utils'
import { assignableWindow } from '../utils/globals'

describe('sdk dist channel', () => {
    afterEach(() => {
        Config.SDK_DIST_CHANNEL = undefined
        assignableWindow.posthog = undefined as any
    })

    it('does not report dist channel before an entrypoint sets it', () => {
        Config.SDK_DIST_CHANNEL = undefined

        expect(getEventProperties()).not.toHaveProperty(SDK_DIST_CHANNEL)
    })

    it('does not report empty dist channel', () => {
        ;(Config as any).SDK_DIST_CHANNEL = ''

        expect(getEventProperties()).not.toHaveProperty(SDK_DIST_CHANNEL)
    })

    it('reports npm for module usage', () => {
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
