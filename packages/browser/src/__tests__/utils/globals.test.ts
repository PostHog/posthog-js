import * as commonGlobals from '@posthog/browser-common/utils/globals'
import { assignableWindow, window } from '../../utils/globals'

describe('browser globals', () => {
    it('uses the browser-common window for the browser-v1 global registry', () => {
        expect(window).toBe(commonGlobals.window)
        expect(assignableWindow).toBe(commonGlobals.window)
    })
})
