import '../helpers/mock-logger'
import { HistoryAutocapture } from '../../extensions/history-autocapture'
import type { PostHogConfig } from '../../types'

describe('HistoryAutocapture', () => {
    let posthog: any
    let capture: jest.Mock
    let historyAutocapture: HistoryAutocapture
    let originalPushState: typeof window.history.pushState
    let originalReplaceState: typeof window.history.replaceState
    let pageViewManagerDoPageView: jest.Mock
    let scrollManagerResetContext: jest.Mock
    let mockLocation: { pathname: string; search: string; hash: string; href: string }

    const restartWithCapturePageview = (capturePageview: PostHogConfig['capture_pageview']): void => {
        historyAutocapture.stop()
        window.history.pushState = originalPushState
        window.history.replaceState = originalReplaceState
        posthog.config.capture_pageview = capturePageview
        historyAutocapture = new HistoryAutocapture(posthog)
        historyAutocapture.startIfEnabled()
        capture.mockClear()
    }

    beforeEach(() => {
        originalPushState = window.history.pushState
        originalReplaceState = window.history.replaceState

        // Setup mock location, doing it this way we can use the history methods as triggers
        // on the actual implementation but control the location object for the tests
        mockLocation = {
            pathname: '/initial',
            search: '',
            hash: '',
            href: 'http://localhost/initial',
        }
        Object.defineProperty(window, 'location', {
            get: () => mockLocation,
            configurable: true,
        })

        capture = jest.fn()
        pageViewManagerDoPageView = jest.fn().mockReturnValue({ $pageview_id: 'test-id' })
        scrollManagerResetContext = jest.fn()

        posthog = {
            capture,
            config: {
                capture_pageview: 'history_change',
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

        historyAutocapture.stop()
    })

    describe('Initialization and Configuration', () => {
        it('should initialize correctly', () => {
            expect(historyAutocapture).toBeDefined()
            expect((window.history.pushState as any).__posthog_wrapped__).toBe(true)
            expect((window.history.replaceState as any).__posthog_wrapped__).toBe(true)
        })

        it('should NOT be enabled with true option for backwards compatibility', () => {
            posthog.config.capture_pageview = true
            const historyAutocaptureEnabled = new HistoryAutocapture(posthog)
            expect(historyAutocaptureEnabled.isEnabled).toBe(false)
        })

        it('should be disabled with false option', () => {
            posthog.config.capture_pageview = false
            const historyAutocaptureDisabled = new HistoryAutocapture(posthog)
            expect(historyAutocaptureDisabled.isEnabled).toBe(false)
        })

        it('should be enabled with history_change option', () => {
            posthog.config.capture_pageview = 'history_change'
            const historyAutocaptureEnabled = new HistoryAutocapture(posthog)
            expect(historyAutocaptureEnabled.isEnabled).toBe(true)
        })

        it('should be enabled with granular options', () => {
            posthog.config.capture_pageview = { search: true }
            const historyAutocaptureEnabled = new HistoryAutocapture(posthog)
            expect(historyAutocaptureEnabled.isEnabled).toBe(true)
        })

        it('should not setup event listeners if feature is disabled', () => {
            window.history.pushState = originalPushState
            window.history.replaceState = originalReplaceState

            posthog.config.capture_pageview = false
            const historyAutocaptureDisabled = new HistoryAutocapture(posthog)
            historyAutocaptureDisabled.startIfEnabled()

            expect((window.history.pushState as any).__posthog_wrapped__).toBeUndefined()
            expect((window.history.replaceState as any).__posthog_wrapped__).toBeUndefined()
        })

        it('should be idempotent - calling monitorHistoryChanges multiple times', () => {
            capture.mockClear()

            historyAutocapture.monitorHistoryChanges()
            historyAutocapture.monitorHistoryChanges()

            mockLocation.pathname = '/test-page'
            window.history.pushState({ page: 1 }, 'Test Page', '/test-page')

            expect(capture).toHaveBeenCalledTimes(1)
        })

        it('should apply granular options when configuration changes at runtime', () => {
            restartWithCapturePageview({ path: true })

            posthog.config.capture_pageview = { hash: true }
            historyAutocapture.startIfEnabledOrStop()

            mockLocation.hash = '#section'
            window.dispatchEvent(new Event('hashchange'))

            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'hashchange' })

            posthog.config.capture_pageview = false
            historyAutocapture.startIfEnabledOrStop()
            capture.mockClear()

            mockLocation.hash = '#details'
            window.dispatchEvent(new Event('hashchange'))

            expect(capture).not.toHaveBeenCalled()
        })
    })

    describe('pushState events', () => {
        it('should capture pageview when pathname changes with pushState', () => {
            capture.mockClear()

            mockLocation.pathname = '/new-path'
            window.history.pushState({ page: 1 }, 'Test Page', '/new-path')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })

        it('should not capture when only the query string changes with history_change', () => {
            capture.mockClear()

            mockLocation.search = '?param=value'
            window.history.pushState({ page: 1 }, 'Test Page', '/initial?param=value')

            expect(capture).not.toHaveBeenCalled()
        })

        it('should not capture pageview when capture_pageview is disabled', () => {
            restartWithCapturePageview(false)

            mockLocation.pathname = '/new-disabled-path'
            window.history.pushState({ page: 1 }, 'Test Page', '/new-disabled-path')

            expect(capture).not.toHaveBeenCalled()
        })
    })

    describe('replaceState events', () => {
        it('should capture pageview when pathname changes with replaceState', () => {
            capture.mockClear()

            mockLocation.pathname = '/replaced-path'
            window.history.replaceState({ page: 2 }, 'Test Page 2', '/replaced-path')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'replaceState' })
        })

        it('should not capture when only the hash changes with history_change', () => {
            capture.mockClear()

            mockLocation.hash = '#section'
            window.history.replaceState({ page: 2 }, 'Test Page 2', '/initial#section')

            expect(capture).not.toHaveBeenCalled()
        })
    })

    describe('popstate events', () => {
        it('should capture pageview when pathname changes with popstate', () => {
            capture.mockClear()

            mockLocation.pathname = '/popstate-path'
            window.dispatchEvent(new PopStateEvent('popstate', { state: { page: 3 } }))

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'popstate' })
        })

        it('should not capture pageview when pathname does not change with popstate', () => {
            capture.mockClear()

            window.dispatchEvent(new PopStateEvent('popstate', { state: { page: 3 } }))

            expect(capture).not.toHaveBeenCalled()
        })
    })

    describe('granular URL options', () => {
        it('should capture pathname changes when path is enabled', () => {
            restartWithCapturePageview({ path: true })

            mockLocation.pathname = '/new-path'
            window.history.pushState({ page: 1 }, 'Test Page', '/new-path')

            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })

        it('should capture query string changes when search is enabled', () => {
            restartWithCapturePageview({ search: true })

            mockLocation.search = '?param=value'
            window.history.pushState({ page: 1 }, 'Test Page', '/initial?param=value')

            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })

        it('should capture hash changes through the history API when hash is enabled', () => {
            restartWithCapturePageview({ hash: true })

            mockLocation.hash = '#section'
            window.history.replaceState({ page: 1 }, 'Test Page', '/initial#section')

            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'replaceState' })
        })

        it('should capture selected URL changes on popstate', () => {
            restartWithCapturePageview({ search: true })

            mockLocation.search = '?page=2'
            window.dispatchEvent(new PopStateEvent('popstate', { state: { page: 2 } }))

            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'popstate' })
        })

        it('should ignore changes to URL components that are not enabled', () => {
            restartWithCapturePageview({ search: true })

            mockLocation.pathname = '/new-path'
            mockLocation.hash = '#section'
            window.history.pushState({ page: 1 }, 'Test Page', '/new-path#section')

            expect(capture).not.toHaveBeenCalled()
        })

        it('should capture once when multiple enabled URL components change', () => {
            restartWithCapturePageview({ path: true, search: true, hash: true })

            mockLocation.pathname = '/new-path'
            mockLocation.search = '?param=value'
            mockLocation.hash = '#section'
            window.history.pushState({ page: 1 }, 'Test Page', '/new-path?param=value#section')

            expect(capture).toHaveBeenCalledTimes(1)
        })

        it('should not capture when a history method is called with an identical URL', () => {
            restartWithCapturePageview({ path: true, search: true, hash: true })

            window.history.pushState({ page: 1 }, 'Test Page', '/initial')

            expect(capture).not.toHaveBeenCalled()
        })

        it('should not capture hash changes when disable_capture_url_hashes is set', () => {
            posthog.config.disable_capture_url_hashes = true
            restartWithCapturePageview({ hash: true })

            mockLocation.hash = '#section'
            window.history.pushState({ page: 1 }, 'Test Page', '/initial#section')

            expect(capture).not.toHaveBeenCalled()
        })
    })

    describe('hashchange events', () => {
        it('should not capture direct hash changes with history_change', () => {
            capture.mockClear()

            mockLocation.hash = '#section'
            window.dispatchEvent(new Event('hashchange'))

            expect(capture).not.toHaveBeenCalled()
        })

        it('should capture direct hash changes when hash is enabled', () => {
            restartWithCapturePageview({ hash: true })

            mockLocation.hash = '#section'
            window.dispatchEvent(new Event('hashchange'))

            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'hashchange' })
        })

        it('should not capture a false pageview on a no-op history call after a direct hash change', () => {
            restartWithCapturePageview({ hash: true })

            mockLocation.hash = '#section'
            window.dispatchEvent(new Event('hashchange'))

            expect(capture).toHaveBeenCalledTimes(1)
            capture.mockClear()

            window.history.replaceState({ page: 1 }, 'Test Page', '/initial#section')

            expect(capture).not.toHaveBeenCalled()
        })

        it('should capture once when a hash traversal fires popstate and hashchange', () => {
            restartWithCapturePageview({ hash: true })

            mockLocation.hash = '#section'
            window.dispatchEvent(new PopStateEvent('popstate'))
            window.dispatchEvent(new Event('hashchange'))

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'popstate' })
        })

        it('should not capture on hashchange when disable_capture_url_hashes is set', () => {
            posthog.config.disable_capture_url_hashes = true
            restartWithCapturePageview({ hash: true })

            mockLocation.hash = '#section'
            window.dispatchEvent(new Event('hashchange'))

            expect(capture).not.toHaveBeenCalled()
        })
    })

    describe('Complex URL changes', () => {
        it('should capture pageview when pathname changes even with query parameter changes', () => {
            capture.mockClear()

            mockLocation.pathname = '/products'
            mockLocation.search = '?category=electronics'
            window.history.pushState({ page: 1 }, 'Products', '/products?category=electronics')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })

        it('should capture pageview when pathname changes even with hash changes', () => {
            capture.mockClear()

            mockLocation.pathname = '/about'
            mockLocation.hash = '#team'
            window.history.pushState({ page: 1 }, 'About', '/about#team')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })

        it('should capture pageview when pathname changes with query and hash changes', () => {
            capture.mockClear()

            mockLocation.pathname = '/blog'
            mockLocation.search = '?author=john'
            mockLocation.hash = '#comments'
            window.history.pushState({ page: 1 }, 'Blog', '/blog?author=john#comments')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })

        it('should not capture with history_change when only query and hash change together', () => {
            capture.mockClear()

            mockLocation.search = '?filter=new'
            mockLocation.hash = '#results'
            window.history.pushState({ page: 1 }, 'Filter Results', '/initial?filter=new#results')

            expect(capture).not.toHaveBeenCalled()
        })
    })

    describe('Edge cases', () => {
        it('should capture pageview when changing to root path', () => {
            capture.mockClear()

            // Set initial path to something other than root
            mockLocation.pathname = '/some-path'

            // Then navigate to root
            mockLocation.pathname = '/'
            window.history.pushState({ page: 1 }, 'Home', '/')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })

        it('should capture pageview when changing from root path', () => {
            capture.mockClear()

            // Set initial path to root
            mockLocation.pathname = '/'

            restartWithCapturePageview('history_change')

            // Then navigate to another path
            mockLocation.pathname = '/dashboard'
            window.history.pushState({ page: 1 }, 'Dashboard', '/dashboard')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })

        it('should capture pageview for trailing slash differences in the same path', () => {
            // This test checks if we're normalizing paths before comparison
            // Currently the implementation does a direct comparison which means
            // /path and /path/ would be considered different pathnames

            // This behavior might vary depending on your specific requirements
            capture.mockClear()

            // Set initial path without trailing slash
            mockLocation.pathname = '/profile'

            restartWithCapturePageview('history_change')

            mockLocation.pathname = '/profile/'
            window.history.pushState({ page: 1 }, 'Profile', '/profile/')

            // Based on current implementation this SHOULD capture a pageview
            // because pathnames are directly compared without normalization
            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
        })
    })

    describe('PageViewManager integration', () => {
        it('should call PageViewManager.doPageView when capturing a pageview', () => {
            // Setup capture to call pageViewManagerDoPageView to simulate
            // what would happen in the actual implementation
            capture.mockImplementation((eventName, properties) => {
                if (eventName === '$pageview') {
                    pageViewManagerDoPageView(new Date(), 'test-uuid')
                }
                return { event: eventName, properties }
            })

            // Update location and trigger pushState
            mockLocation.pathname = '/pageviewmanager-test'
            window.history.pushState({ page: 1 }, 'Test Page', '/pageviewmanager-test')

            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
            expect(pageViewManagerDoPageView).toHaveBeenCalledTimes(1)
        })

        it('should track history through multiple pageviews', () => {
            const firstPageviewId = 'first-pageview-id'
            const secondPageviewId = 'second-pageview-id'

            // Setup pageview sequence with proper ID tracking
            capture.mockImplementation((eventName, properties) => {
                if (eventName === '$pageview') {
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
            mockLocation.pathname = '/page-1'
            window.history.pushState({ page: 1 }, 'Page 1', '/page-1')

            capture.mockClear()
            pageViewManagerDoPageView.mockClear()

            // Second navigation
            mockLocation.pathname = '/page-2'
            window.history.pushState({ page: 2 }, 'Page 2', '/page-2')

            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture).toHaveBeenCalledWith('$pageview', { navigation_type: 'pushState' })
            expect(pageViewManagerDoPageView).toHaveBeenCalledTimes(1)
        })
    })

    describe('Error handling', () => {
        it('should handle errors gracefully if location is undefined', () => {
            capture.mockClear()

            const tempLocation = mockLocation
            mockLocation = undefined

            expect(() => {
                window.history.pushState({ page: 1 }, 'Test Page', '/new-path')
            }).not.toThrow()

            mockLocation = tempLocation
        })
    })

    describe('Cleanup', () => {
        it('should properly clean up event listeners when stopped', () => {
            const addEventListenerSpy = jest.spyOn(window, 'addEventListener')
            const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener')

            // Create a new instance to track the fresh add/remove calls
            posthog.config.capture_pageview = { hash: true }
            const newHistoryAutocapture = new HistoryAutocapture(posthog)
            newHistoryAutocapture.startIfEnabled()

            expect(addEventListenerSpy).toHaveBeenCalledWith('popstate', expect.any(Function), expect.any(Object))
            expect(addEventListenerSpy).toHaveBeenCalledWith('hashchange', expect.any(Function), expect.any(Object))

            newHistoryAutocapture.stop()

            expect(removeEventListenerSpy).toHaveBeenCalledWith('popstate', expect.any(Function))
            expect(removeEventListenerSpy).toHaveBeenCalledWith('hashchange', expect.any(Function))

            addEventListenerSpy.mockRestore()
            removeEventListenerSpy.mockRestore()
        })
    })
})
