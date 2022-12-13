import { _UUID } from '../utils'
import { PageViewIdManager } from '../page-view-id'

jest.mock('../utils')

describe('PageView ID manager', () => {
    given('pageViewIdManager', () => new PageViewIdManager())

    beforeEach(() => {
        _UUID.mockReturnValue('subsequentUUIDs').mockReturnValueOnce('firstUUID').mockReturnValueOnce('secondUUID')
    })

    it('generates a page view id and resets page view id', () => {
        expect(given.pageViewIdManager.getPageViewId()).toEqual('firstUUID')

        // First pageview should NOT rotate the UUID
        given.pageViewIdManager.onPageview()
        expect(given.pageViewIdManager.getPageViewId()).toEqual('firstUUID')

        given.pageViewIdManager.onPageview()
        expect(given.pageViewIdManager.getPageViewId()).toEqual('secondUUID')

        given.pageViewIdManager.onPageview()
        expect(given.pageViewIdManager.getPageViewId()).toEqual('subsequentUUIDs')
    })
})
