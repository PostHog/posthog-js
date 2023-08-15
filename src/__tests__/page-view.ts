import { PageViewManager } from '../page-view'
import { uuidv7 } from '../uuidv7'
jest.mock('../uuidv7')

describe('PageView ID manager', () => {
    const FIRST_UUID = 'FIRST_UUID'
    const SECOND_UUID = 'SECOND_UUID'

    beforeEach(() => {
        ;(uuidv7 as any)
            .mockReturnValue('subsequentUUIDs')
            .mockReturnValueOnce(FIRST_UUID)
            .mockReturnValueOnce(SECOND_UUID)
    })

    it('creates a page view id for each page', () => {
        const pageViewIdManager = new PageViewManager()
        const firstPageView = pageViewIdManager.doPageView()
        expect(firstPageView.$pageview_id).toEqual(FIRST_UUID)
        expect(firstPageView.$prev_pageview_pageview_id).toBeUndefined()

        const firstEvent = pageViewIdManager.getNonPageEvent()
        expect(firstEvent.$pageview_id).toEqual(FIRST_UUID)

        const secondPageView = pageViewIdManager.doPageView()
        expect(secondPageView.$pageview_id).toEqual(SECOND_UUID)
        expect(secondPageView.$prev_pageview_pageview_id).toEqual(FIRST_UUID)

        const secondEvent = pageViewIdManager.getNonPageEvent()
        expect(secondEvent.$pageview_id).toEqual(SECOND_UUID)
    })

    it('creates a page view id for the first event, and doesnt rotate for first page view', () => {
        const pageViewIdManager = new PageViewManager()

        const firstEvent = pageViewIdManager.getNonPageEvent()
        expect(firstEvent.$pageview_id).toEqual(FIRST_UUID)

        const firstPageView = pageViewIdManager.doPageView()
        expect(firstPageView.$pageview_id).toEqual(FIRST_UUID)
        expect(firstPageView.$prev_pageview_pageview_id).toBeUndefined()

        const secondPageView = pageViewIdManager.doPageView()
        expect(secondPageView.$pageview_id).toEqual(SECOND_UUID)
        expect(secondPageView.$prev_pageview_pageview_id).toEqual(FIRST_UUID)
    })

    it('provides a page view id when doPageLeave is called', () => {
        const pageViewIdManager = new PageViewManager()
        pageViewIdManager.doPageView()
        pageViewIdManager.doPageView()

        const pageLeave = pageViewIdManager.doPageLeave()
        expect(pageLeave.$pageview_id).toEqual(SECOND_UUID)
        // this should be the same, it's a bit ugly, but it means that the SQL query makes more sense
        expect(pageLeave.$prev_pageview_pageview_id).toEqual(SECOND_UUID)
    })

    it('provides a page view id when onPageLeave is called even if doPageView has not been called', () => {
        const pageViewIdManager = new PageViewManager()

        const pageLeave = pageViewIdManager.doPageLeave()
        expect(pageLeave.$pageview_id).toEqual(FIRST_UUID)
        expect(pageLeave.$prev_pageview_pageview_id).toBeUndefined()
    })
})
