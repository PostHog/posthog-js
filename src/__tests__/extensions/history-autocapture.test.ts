import '../helpers/mock-logger'
import { HistoryAutocapture } from '../../extensions/history-autocapture'

describe('HistoryAutocapture', () => {
    let posthog: any
    let capture: jest.Mock
    let historyAutocapture: HistoryAutocapture
    let originalPushState: any
    let originalReplaceState: any
    let pageViewManagerDoPageView: jest.Mock
    let scrollManagerResetContext: jest.Mock

    beforeEach(() => {
        // Save original history methods
        originalPushState = window.history.pushState
        originalReplaceState = window.history.replaceState

        // Create mocks
        capture = jest.fn()
        pageViewManagerDoPageView = jest.fn().mockReturnValue({ $pageview_id: 'test-id' })
        scrollManagerResetContext = jest.fn()

        // Create a mock PostHog instance
        posthog = {
            capture,
            config: {
                capture_history_events: true,
            },
            pageViewManager: {
                doPageView: pageViewManagerDoPageView,
            },
            scrollManager: {
                resetContext: scrollManagerResetContext,
            },
        }

        historyAutocapture = new HistoryAutocapture(posthog)
        historyAutocapture.monitorHistoryChanges()
    })

    afterEach(() => {
        window.history.pushState = originalPushState
        window.history.replaceState = originalReplaceState

        historyAutocapture.stop()
    })

    it('should initialize correctly', () => {
        expect(historyAutocapture).toBeDefined()
        expect((window.history.pushState as any).__posthog_wrapped__).toBe(true)
        expect((window.history.replaceState as any).__posthog_wrapped__).toBe(true)
    })

    it('should capture pageview event on pushState', () => {
        capture.mockClear()

        window.history.pushState({ page: 1 }, 'Test Page', '/test-page')

        expect(capture).toHaveBeenCalledTimes(1)
        expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
    })

    it('should capture pageview event on replaceState', () => {
        capture.mockClear()

        window.history.replaceState({ page: 2 }, 'Test Page 2', '/test-page-2')

        expect(capture).toHaveBeenCalledTimes(1)
        expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'replaceState' })
    })

    it('should capture pageview event on popstate', () => {
        capture.mockClear()

        window.dispatchEvent(new PopStateEvent('popstate', { state: { page: 3 } }))

        expect(capture).toHaveBeenCalledTimes(1)
        expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'popstate' })
    })

    it('should not setup event listeners if feature is disabled', () => {
        window.history.pushState = originalPushState
        window.history.replaceState = originalReplaceState

        posthog.config.capture_history_events = false
        const historyAutocaptureDisabled = new HistoryAutocapture(posthog)

        historyAutocaptureDisabled.startIfEnabled()

        expect((window.history.pushState as any).__posthog_wrapped__).toBeUndefined()
        expect((window.history.replaceState as any).__posthog_wrapped__).toBeUndefined()
    })

    it('should be idempotent - calling monitorHistoryChanges multiple times', () => {
        capture.mockClear()

        historyAutocapture.monitorHistoryChanges()
        historyAutocapture.monitorHistoryChanges()

        window.history.pushState({ page: 1 }, 'Test Page', '/test-page')

        expect(capture).toHaveBeenCalledTimes(1)
    })

    describe('PageViewManager integration', () => {
        it('should call PageViewManager.doPageView when capturing a pageview', () => {
            capture.mockImplementation((eventName, properties) => {
                if (eventName === '$pageview') {
                    // This emulates what would happen in _calculate_event_properties
                    // when capture('$pageview') is called
                    pageViewManagerDoPageView(new Date(), 'test-uuid')
                }
                return { event: eventName, properties }
            })

            window.history.pushState({ page: 1 }, 'Test Page', '/test-page')

            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
            expect(pageViewManagerDoPageView).toHaveBeenCalledTimes(1)
        })

        it('should track history through multiple pageviews', () => {
            // Set initial pageview ID
            const firstPageviewId = 'first-pageview-id'
            const secondPageviewId = 'second-pageview-id'

            capture.mockImplementation((eventName, properties) => {
                if (eventName === '$pageview') {
                    // This emulates what would happen in _calculate_event_properties
                    // when capture('$pageview') is called
                    if (capture.mock.calls.length === 1) {
                        pageViewManagerDoPageView.mockReturnValueOnce({
                            $pageview_id: firstPageviewId,
                        })
                    } else {
                        pageViewManagerDoPageView.mockReturnValueOnce({
                            $pageview_id: secondPageviewId,
                            $prev_pageview_id: firstPageviewId,
                            $prev_pageview_pathname: '/page-1',
                        })
                    }

                    pageViewManagerDoPageView(new Date(), 'test-uuid')
                }
                return { event: eventName, properties }
            })

            // First navigation
            window.history.pushState({ page: 1 }, 'Page 1', '/page-1')

            capture.mockClear()
            pageViewManagerDoPageView.mockClear()

            // Second navigation
            window.history.pushState({ page: 2 }, 'Page 2', '/page-2')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
            expect(pageViewManagerDoPageView).toHaveBeenCalledTimes(1)
        })
    })
})
