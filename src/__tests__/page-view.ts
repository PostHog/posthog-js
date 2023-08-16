import { PageViewManager } from '../page-view'
import { uuidv7 } from '../uuidv7'
jest.mock('../uuidv7')

describe('PageView ID manager', () => {
    const FIRST_UUID = 'FIRST_UUID'
    const SECOND_UUID = 'SECOND_UUID'

    const window = {
        scrollY: 0,
        document: {
            documentElement: {
                clientHeight: 0,
                scrollHeight: 0,
            },
        },
    } as unknown as Window

    describe('doPageView', () => {
        beforeEach(() => {
            ;(uuidv7 as any)
                .mockReturnValue('subsequentUUIDs')
                .mockReturnValueOnce(FIRST_UUID)
                .mockReturnValueOnce(SECOND_UUID)
        })

        it('creates a page view id for each page', () => {
            const pageViewIdManager = new PageViewManager(window)
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
            const pageViewIdManager = new PageViewManager(window)

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
            const pageViewIdManager = new PageViewManager(window)
            pageViewIdManager.doPageView()
            pageViewIdManager.doPageView()

            const pageLeave = pageViewIdManager.doPageLeave()
            expect(pageLeave.$pageview_id).toEqual(SECOND_UUID)
            // this should be the same, it's a bit ugly, but it means that the SQL query makes more sense
            expect(pageLeave.$prev_pageview_pageview_id).toEqual(SECOND_UUID)
        })

        it('provides a page view id when onPageLeave is called even if doPageView has not been called', () => {
            const pageViewIdManager = new PageViewManager(window)

            const pageLeave = pageViewIdManager.doPageLeave()
            expect(pageLeave.$pageview_id).toEqual(FIRST_UUID)
            expect(pageLeave.$prev_pageview_pageview_id).toBeUndefined()
        })

        it('includes scroll position properties for a partially scrolled long page', () => {
            // note that this means that the user has scrolled 2/3rds of the way down the scrollable area, and seen
            // 3/4 of the content
            const window = {
                scrollY: 2000, // how far down the user has scrolled
                document: {
                    documentElement: {
                        clientHeight: 1000, // how tall the window is
                        scrollHeight: 4000, // how tall the page content is
                    },
                },
            } as unknown as Window

            const pageViewIdManager = new PageViewManager(window)
            pageViewIdManager.doPageView()

            // force the manager to update the scroll data by calling an internal method
            pageViewIdManager._updateScrollData()

            const secondPageView = pageViewIdManager.doPageView()
            expect(secondPageView.$prev_pageview_last_scroll).toEqual(2000)
            expect(secondPageView.$prev_pageview_last_scroll_percentage).toBeCloseTo(2 / 3)
            expect(secondPageView.$prev_pageview_max_scroll).toEqual(2000)
            expect(secondPageView.$prev_pageview_max_scroll_percentage).toBeCloseTo(2 / 3)
            expect(secondPageView.$prev_pageview_last_content).toEqual(3000)
            expect(secondPageView.$prev_pageview_last_content_percentage).toBeCloseTo(3 / 4)
            expect(secondPageView.$prev_pageview_max_content).toEqual(3000)
            expect(secondPageView.$prev_pageview_max_content_percentage).toBeCloseTo(3 / 4)
        })

        it('includes scroll position properties for a short page', () => {
            const window = {
                scrollY: 0,
                document: {
                    documentElement: {
                        clientHeight: 1000, // how tall the window is
                        scrollHeight: 500, // how tall the page content is
                    },
                },
            } as unknown as Window

            const pageViewIdManager = new PageViewManager(window)
            pageViewIdManager.doPageView()

            // force the manager to update the scroll data by calling an internal method
            pageViewIdManager._updateScrollData()

            const secondPageView = pageViewIdManager.doPageView()
            expect(secondPageView.$prev_pageview_last_scroll).toEqual(0)
            expect(secondPageView.$prev_pageview_last_scroll_percentage).toEqual(1)
            expect(secondPageView.$prev_pageview_max_scroll).toEqual(0)
            expect(secondPageView.$prev_pageview_max_scroll_percentage).toEqual(1)
            expect(secondPageView.$prev_pageview_last_content).toEqual(1000)
            expect(secondPageView.$prev_pageview_last_content_percentage).toEqual(1)
            expect(secondPageView.$prev_pageview_max_content).toEqual(1000)
            expect(secondPageView.$prev_pageview_max_content_percentage).toEqual(1)
        })
    })
})
