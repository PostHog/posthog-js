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
    let originalLocation: Location

    beforeEach(() => {
        // Save original history methods and location
        originalPushState = window.history.pushState
        originalReplaceState = window.history.replaceState
        originalLocation = window.location

        // Mock location
        Object.defineProperty(window, 'location', {
            value: {
                pathname: '/initial-path',
                search: '',
                hash: '',
            },
            writable: true,
        })

        // Create mocks
        capture = jest.fn()
        pageViewManagerDoPageView = jest.fn().mockReturnValue({ $pageview_id: 'test-id' })
        scrollManagerResetContext = jest.fn()

        // Create a mock PostHog instance
        posthog = {
            capture,
            config: {
                capture_history_events: 'pathname',
            },
            pageViewManager: {
                doPageView: pageViewManagerDoPageView,
            },
            scrollManager: {
                resetContext: scrollManagerResetContext,
            },
        }

        historyAutocapture = new HistoryAutocapture(posthog)
        historyAutocapture.startIfEnabled()
    })

    afterEach(() => {
        window.history.pushState = originalPushState
        window.history.replaceState = originalReplaceState
        Object.defineProperty(window, 'location', {
            value: originalLocation,
        })
        historyAutocapture.stop()
    })

    it('should initialize correctly', () => {
        expect(historyAutocapture).toBeDefined()
        expect((window.history.pushState as any).__posthog_wrapped__).toBe(true)
        expect((window.history.replaceState as any).__posthog_wrapped__).toBe(true)
    })

    describe('Configuration options', () => {
        it('should be enabled with "always" option', () => {
            posthog.config.capture_history_events = 'always'
            const historyAutocaptureAlways = new HistoryAutocapture(posthog)
            expect(historyAutocaptureAlways.isEnabled).toBe(true)
        })

        it('should be enabled with "pathname" option', () => {
            posthog.config.capture_history_events = 'pathname'
            const historyAutocapturePathname = new HistoryAutocapture(posthog)
            expect(historyAutocapturePathname.isEnabled).toBe(true)
        })

        it('should be disabled with "never" option', () => {
            posthog.config.capture_history_events = 'never'
            const historyAutocaptureNever = new HistoryAutocapture(posthog)
            expect(historyAutocaptureNever.isEnabled).toBe(false)
        })

        it('should be disabled with non-compatible string', () => {
            posthog.config.capture_history_events = 'pinneaple_on_pizza'
            const historyAutocaptureFalse = new HistoryAutocapture(posthog)
            expect(historyAutocaptureFalse.isEnabled).toBe(false)
        })
    })

    describe('Pathname-only capture', () => {
        beforeEach(() => {
            posthog.config.capture_history_events = 'pathname'
            historyAutocapture = new HistoryAutocapture(posthog)
            historyAutocapture.startIfEnabled()
        })

        it('should capture pageview when pathname changes', () => {
            capture.mockClear()

            Object.defineProperty(window, 'location', {
                value: {
                    pathname: '/new-path',
                    search: '',
                    hash: '',
                },
                writable: true,
            })

            window.history.pushState({ page: 1 }, 'Test Page', '/new-path')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })

        it('should not capture pageview when only query parameters change', () => {
            capture.mockClear()

            Object.defineProperty(window, 'location', {
                value: {
                    pathname: '/initial-path',
                    search: '?param=value',
                    hash: '',
                },
                writable: true,
            })

            window.history.pushState({ page: 1 }, 'Test Page', '/initial-path?param=value')

            expect(capture).not.toHaveBeenCalled()
        })

        it('should not capture pageview when only hash changes', () => {
            capture.mockClear()

            // Mock location to simulate hash change
            Object.defineProperty(window, 'location', {
                value: {
                    pathname: '/initial-path',
                    search: '',
                    hash: '#section',
                },
                writable: true,
            })

            window.history.pushState({ page: 1 }, 'Test Page', '/initial-path#section')

            expect(capture).not.toHaveBeenCalled()
        })

        it('should capture pageview when pathname changes even if query parameters also change', () => {
            capture.mockClear()

            // Mock location to simulate pathname and query parameter change
            Object.defineProperty(window, 'location', {
                value: {
                    pathname: '/new-path',
                    search: '?param=value',
                    hash: '',
                },
                writable: true,
            })

            window.history.pushState({ page: 1 }, 'Test Page', '/new-path?param=value')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })
    })

    describe('Always capture', () => {
        beforeEach(() => {
            posthog.config.capture_history_events = 'always'
            historyAutocapture = new HistoryAutocapture(posthog)
            historyAutocapture.startIfEnabled()
        })

        it('should capture pageview when pathname changes', () => {
            capture.mockClear()

            Object.defineProperty(window, 'location', {
                value: {
                    pathname: '/new-path',
                    search: '',
                    hash: '',
                },
                writable: true,
            })

            window.history.pushState({ page: 1 }, 'Test Page', '/new-path')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })

        it('should capture pageview when only query parameters change', () => {
            capture.mockClear()

            Object.defineProperty(window, 'location', {
                value: {
                    pathname: '/initial-path',
                    search: '?param=value',
                    hash: '',
                },
                writable: true,
            })

            window.history.pushState({ page: 1 }, 'Test Page', '/initial-path?param=value')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })

        it('should capture pageview when only hash changes', () => {
            capture.mockClear()

            // Mock location to simulate hash change
            Object.defineProperty(window, 'location', {
                value: {
                    pathname: '/initial-path',
                    search: '',
                    hash: '#section',
                },
                writable: true,
            })

            window.history.pushState({ page: 1 }, 'Test Page', '/initial-path#section')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })
    })

    describe('Never capture', () => {
        beforeEach(() => {
            posthog.config.capture_history_events = 'never'
            historyAutocapture = new HistoryAutocapture(posthog)
            historyAutocapture.startIfEnabled()
        })

        it('should not capture pageview when pathname changes', () => {
            capture.mockClear()

            Object.defineProperty(window, 'location', {
                value: {
                    pathname: '/new-path',
                    search: '',
                    hash: '',
                },
                writable: true,
            })

            window.history.pushState({ page: 1 }, 'Test Page', '/new-path')

            expect(capture).not.toHaveBeenCalled()
        })

        it('should not capture pageview when query parameters change', () => {
            capture.mockClear()

            Object.defineProperty(window, 'location', {
                value: {
                    pathname: '/initial-path',
                    search: '?param=value',
                    hash: '',
                },
                writable: true,
            })

            window.history.pushState({ page: 1 }, 'Test Page', '/initial-path?param=value')

            expect(capture).not.toHaveBeenCalled()
        })
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

        posthog.config.capture_history_events = 'never'
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
