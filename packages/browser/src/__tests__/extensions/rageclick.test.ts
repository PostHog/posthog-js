import RageClick from '../../extensions/rageclick'
import SharedRageClick from '@posthog/browser-common/rageclick'

describe('RageClick compatibility export', () => {
    it('retains the shared implementation at the legacy path', () => {
        expect(RageClick).toBe(SharedRageClick)
    })
})
