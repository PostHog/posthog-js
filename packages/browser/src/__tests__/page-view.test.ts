import { PageViewManager } from '../page-view'
import { PostHog } from '../posthog-core'
import { ScrollManager } from '../scroll-manager'
import { SessionIdChangedCallback } from '../types'

const mockWindowGetter = jest.fn()
jest.mock('../utils/globals', () => ({
    ...jest.requireActual('../utils/globals'),
    get window() {
        return mockWindowGetter()
    },
}))

describe('PageView ID manager', () => {
    const firstTimestamp = new Date()
    const duration = 42
    const secondTimestamp = new Date(firstTimestamp.getTime() + duration * 1000)
    const pageviewId1 = 'pageview-id-1'
    const pageviewId2 = 'pageview-id-2'

    describe('doPageView', () => {
        let instance: PostHog
        let pageViewIdManager: PageViewManager

        beforeEach(() => {
            instance = {
                config: {},
            } as any
            instance.scrollManager = new ScrollManager(instance)
            pageViewIdManager = new PageViewManager(instance)
            mockWindowGetter.mockReturnValue({
                location: {
                    pathname: '/pathname',
                },
                scrollY: 0,
                document: {
                    documentElement: {
                        clientHeight: 0,
                        scrollHeight: 0,
                    },
                },
            })
        })

        it('includes scroll position properties for a partially scrolled long page', () => {
            // note that this means that the user has scrolled 2/3rds of the way down the scrollable area, and seen
            // 3/4 of the content
            mockWindowGetter.mockReturnValue({
                location: {
                    pathname: '/pathname',
                },
                scrollY: 2000, // how far down the user has scrolled
                document: {
                    documentElement: {
                        clientHeight: 1000, // how tall the window is
                        scrollHeight: 4000, // how tall the page content is
                    },
                },
            })

            pageViewIdManager.doPageView(firstTimestamp, pageviewId1)

            // force the manager to update the scroll data by calling an internal method
            instance.scrollManager['_updateScrollData']()

            const secondPageView = pageViewIdManager.doPageView(secondTimestamp, pageviewId2)
            expect(secondPageView.$prev_pageview_last_scroll).toEqual(2000)
            expect(secondPageView.$prev_pageview_last_scroll_percentage).toBeCloseTo(2 / 3)
            expect(secondPageView.$prev_pageview_max_scroll).toEqual(2000)
            expect(secondPageView.$prev_pageview_max_scroll_percentage).toBeCloseTo(2 / 3)
            expect(secondPageView.$prev_pageview_last_content).toEqual(3000)
            expect(secondPageView.$prev_pageview_last_content_percentage).toBeCloseTo(3 / 4)
            expect(secondPageView.$prev_pageview_max_content).toEqual(3000)
            expect(secondPageView.$prev_pageview_max_content_percentage).toBeCloseTo(3 / 4)
            expect(secondPageView.$prev_pageview_duration).toEqual(duration)
            expect(secondPageView.$prev_pageview_id).toEqual(pageviewId1)
            expect(secondPageView.$pageview_id).toEqual(pageviewId2)
        })

        it('includes scroll position properties for a short page', () => {
            mockWindowGetter.mockReturnValue({
                location: {
                    pathname: '/pathname',
                },
                scrollY: 0,
                document: {
                    documentElement: {
                        clientHeight: 1000, // how tall the window is
                        scrollHeight: 500, // how tall the page content is
                    },
                },
            })

            pageViewIdManager.doPageView(firstTimestamp, pageviewId1)

            // force the manager to update the scroll data by calling an internal method
            instance.scrollManager['_updateScrollData']()

            const secondPageView = pageViewIdManager.doPageView(secondTimestamp, pageviewId2)
            expect(secondPageView.$prev_pageview_last_scroll).toEqual(0)
            expect(secondPageView.$prev_pageview_last_scroll_percentage).toEqual(1)
            expect(secondPageView.$prev_pageview_max_scroll).toEqual(0)
            expect(secondPageView.$prev_pageview_max_scroll_percentage).toEqual(1)
            expect(secondPageView.$prev_pageview_last_content).toEqual(1000)
            expect(secondPageView.$prev_pageview_last_content_percentage).toEqual(1)
            expect(secondPageView.$prev_pageview_max_content).toEqual(1000)
            expect(secondPageView.$prev_pageview_max_content_percentage).toEqual(1)
            expect(secondPageView.$prev_pageview_duration).toEqual(duration)
            expect(secondPageView.$prev_pageview_id).toEqual(pageviewId1)
            expect(secondPageView.$pageview_id).toEqual(pageviewId2)
        })

        it('can handle scroll updates before doPageView is called', () => {
            instance.scrollManager['_updateScrollData']()
            const firstPageView = pageViewIdManager.doPageView(firstTimestamp, pageviewId1)
            expect(firstPageView.$prev_pageview_last_scroll).toBeUndefined()

            const secondPageView = pageViewIdManager.doPageView(secondTimestamp, pageviewId2)
            expect(secondPageView.$prev_pageview_last_scroll).toBeDefined()
        })

        it('should include the pathname', () => {
            instance.scrollManager['_updateScrollData']()
            const firstPageView = pageViewIdManager.doPageView(firstTimestamp, pageviewId1)
            expect(firstPageView.$prev_pageview_pathname).toBeUndefined()
            const secondPageView = pageViewIdManager.doPageView(secondTimestamp, pageviewId2)
            expect(secondPageView.$prev_pageview_pathname).toEqual('/pathname')
        })
    })

    describe('session rotation handling', () => {
        let instance: PostHog
        let pageViewManager: PageViewManager
        let sessionIdCallback: SessionIdChangedCallback

        beforeEach(() => {
            const mockOnSessionId = jest.fn((callback: SessionIdChangedCallback) => {
                sessionIdCallback = callback
                return () => {} // unsubscribe function
            })

            instance = {
                config: {},
                sessionManager: {
                    onSessionId: mockOnSessionId,
                },
                scrollManager: {
                    resetContext: jest.fn(),
                    getContext: jest.fn(),
                },
            } as unknown as PostHog

            pageViewManager = new PageViewManager(instance)
            mockWindowGetter.mockReturnValue({
                location: { pathname: '/page-a' },
            })
        })

        it('should subscribe to session changes on construction', () => {
            expect(instance.sessionManager!.onSessionId).toHaveBeenCalledTimes(1)
        })

        it('should clear state on activity timeout session rotation', () => {
            // Setup: Create initial pageview
            pageViewManager.doPageView(new Date('2024-01-01T10:00:00'), 'pv-1')
            expect(pageViewManager._currentPageview).toBeDefined()
            expect(pageViewManager._currentPageview?.pathname).toBe('/page-a')

            // Act: Simulate session rotation due to activity timeout (30 min idle)
            sessionIdCallback('new-session-id', 'new-window-id', {
                noSessionId: false,
                activityTimeout: true,
                sessionPastMaximumLength: false,
            })

            // Assert: State should be cleared
            expect(pageViewManager._currentPageview).toBeUndefined()
            expect(instance.scrollManager.resetContext).toHaveBeenCalled()
        })

        it('should clear state on session past maximum length', () => {
            // Setup: Create initial pageview
            pageViewManager.doPageView(new Date('2024-01-01T10:00:00'), 'pv-1')

            // Act: Simulate session rotation due to 24 hour max length
            sessionIdCallback('new-session-id', 'new-window-id', {
                noSessionId: false,
                activityTimeout: false,
                sessionPastMaximumLength: true,
            })

            // Assert: State should be cleared
            expect(pageViewManager._currentPageview).toBeUndefined()
        })

        it('should clear state on noSessionId (after posthog.reset())', () => {
            // Setup: Create initial pageview
            pageViewManager.doPageView(new Date('2024-01-01T10:00:00'), 'pv-1')

            // Act: Simulate session change after posthog.reset()
            sessionIdCallback('new-session-id', 'new-window-id', {
                noSessionId: true,
                activityTimeout: false,
                sessionPastMaximumLength: false,
            })

            // Assert: State should be cleared
            expect(pageViewManager._currentPageview).toBeUndefined()
            expect(instance.scrollManager.resetContext).toHaveBeenCalled()
        })

        it('should NOT clear state when changeReason is undefined (initial session)', () => {
            // Setup: Create initial pageview
            pageViewManager.doPageView(new Date('2024-01-01T10:00:00'), 'pv-1')

            // Act: Simulate initial session creation (no changeReason)
            sessionIdCallback('session-id', 'window-id', undefined)

            // Assert: State should remain - this is just initial session, not a rotation
            expect(pageViewManager._currentPageview).toBeDefined()
        })

        it('should not include $prev_pageview_duration after session rotation', () => {
            // Setup: Create pageview in session 1
            const session1Time = new Date('2024-01-01T10:00:00')
            pageViewManager.doPageView(session1Time, 'pv-1')

            // Simulate 35 minutes passing then session rotation
            sessionIdCallback('session-2', 'window-2', {
                noSessionId: false,
                activityTimeout: true,
                sessionPastMaximumLength: false,
            })

            // Act: First pageview in new session (35 min later)
            const session2Time = new Date('2024-01-01T10:35:00')
            mockWindowGetter.mockReturnValue({
                location: { pathname: '/page-b' },
            })
            const properties = pageViewManager.doPageView(session2Time, 'pv-2')

            // Assert: Should NOT have $prev_pageview_duration (would be 35 min cross-session)
            expect(properties.$prev_pageview_duration).toBeUndefined()
            expect(properties.$prev_pageview_pathname).toBeUndefined()
            expect(properties.$pageview_id).toBe('pv-2')
        })

        it('should cleanup subscription on destroy', () => {
            const unsubscribe = jest.fn()
            const mockOnSessionId = jest.fn(() => unsubscribe)

            instance = {
                config: {},
                sessionManager: { onSessionId: mockOnSessionId },
                scrollManager: { resetContext: jest.fn(), getContext: jest.fn() },
            } as unknown as PostHog

            pageViewManager = new PageViewManager(instance)
            pageViewManager.destroy()

            expect(unsubscribe).toHaveBeenCalled()
        })
    })
})
