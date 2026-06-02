import Config from '../config'
import { init_as_module, init_from_snippet } from '../posthog-core'
import { getEventProperties } from '../utils/event-utils'
import { assignableWindow } from '../utils/globals'

describe('sdk install source', () => {
    afterEach(() => {
        Config.SDK_INSTALL_SOURCE = undefined
        assignableWindow.posthog = undefined as any
    })

    it('does not report install source before an entrypoint sets it', () => {
        Config.SDK_INSTALL_SOURCE = undefined

        expect(getEventProperties()).not.toHaveProperty('$sdk_install_source')
    })

    it('does not report empty install source', () => {
        ;(Config as any).SDK_INSTALL_SOURCE = ''

        expect(getEventProperties()).not.toHaveProperty('$sdk_install_source')
    })

    it('reports npm for module usage', () => {
        Config.SDK_INSTALL_SOURCE = 'script_loader'

        init_as_module()

        expect(getEventProperties()['$sdk_install_source']).toBe('npm')
    })

    it('reports script_loader for snippet usage', () => {
        assignableWindow.posthog = { _i: [] } as any

        init_from_snippet()

        expect(getEventProperties()['$sdk_install_source']).toBe('script_loader')
    })
})
