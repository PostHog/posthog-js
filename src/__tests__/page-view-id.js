import { SessionIdManager } from '../sessionid'
import { SESSION_ID } from '../posthog-persistence'
import { sessionStore } from '../storage'
import { _UUID } from '../utils'
import { PageViewIdManager } from '../page-view-id'

jest.mock('../utils')

describe('PageView ID manager', () => {
    given('pageViewIdManager', () => new PageViewIdManager())

    beforeEach(() => {
        _UUID.mockReturnValue('subsequentUUIDs').mockReturnValueOnce('firstUUID').mockReturnValueOnce('secondUUID')
    })

    it('generates a page view id and resets page view id', () => {
        expect(given.pageViewIdManager._pageViewId).toEqual(null)
        // call without reset generates
        expect(given.pageViewIdManager.getPageViewId()).toEqual('firstUUID')

        given.pageViewIdManager.resetPageViewId()
        expect(given.pageViewIdManager.getPageViewId()).toEqual('secondUUID')

        given.pageViewIdManager.resetPageViewId()
        expect(given.pageViewIdManager.getPageViewId()).toEqual('subsequentUUIDs')
    })
})
