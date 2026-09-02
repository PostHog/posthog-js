import React from 'react'
import { render } from '@testing-library/react'
import { PostHogPageView } from '../src/pages/PostHogPageView'

const { mockCapture, mockUsePostHog, mockRouterState } = vi.hoisted(() => {
    const mockCapture = vi.fn()
    return {
        mockCapture,
        mockUsePostHog: vi.fn(() => ({ capture: mockCapture, config: { disable_capture_url_hashes: false } })),
        mockRouterState: { current: { asPath: '/initial', pathname: '/initial', isReady: true } },
    }
})

vi.mock('@posthog/react', () => ({
    usePostHog: () => mockUsePostHog(),
}))

vi.mock('next/router.js', () => ({
    useRouter: () => mockRouterState.current,
}))

describe('Pages PostHogPageView', () => {
    beforeEach(() => {
        mockCapture.mockClear()
        mockUsePostHog.mockReset()
        mockUsePostHog.mockReturnValue({ capture: mockCapture, config: { disable_capture_url_hashes: false } })
        mockRouterState.current = { asPath: '/initial', pathname: '/initial', isReady: true }
    })

    it('captures a $pageview event on mount', () => {
        render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: 'http://localhost/initial',
        })
    })

    it.each([
        ['keeps hash fragments by default', undefined, 'http://localhost/search?q=hello&page=2#section'],
        [
            'keeps hash fragments when disable_capture_url_hashes is false',
            false,
            'http://localhost/search?q=hello&page=2#section',
        ],
        [
            'strips hash fragments when disable_capture_url_hashes is true',
            true,
            'http://localhost/search?q=hello&page=2',
        ],
    ])('%s', (_description, disableCaptureUrlHashes, expectedUrl) => {
        mockUsePostHog.mockReturnValue({
            capture: mockCapture,
            config: { disable_capture_url_hashes: disableCaptureUrlHashes },
        })
        mockRouterState.current = { asPath: '/search?q=hello&page=2#section', pathname: '/search', isReady: true }
        render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: expectedUrl,
        })
    })

    it('captures the route template while preserving the concrete URL', () => {
        mockRouterState.current = { asPath: '/posts/123?ref=test#comments', pathname: '/posts/[id]', isReady: true }

        render(<PostHogPageView captureRouteTemplate />)

        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: 'http://localhost/posts/123?ref=test#comments',
            $route: '/posts/[id]',
        })
    })

    it('normalizes optional catch-all route templates', () => {
        mockRouterState.current = {
            asPath: '/docs/guides/setup',
            pathname: '/docs/[[...slug]]',
            isReady: true,
        }

        render(<PostHogPageView captureRouteTemplate />)

        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: 'http://localhost/docs/guides/setup',
            $route: '/docs/[...slug]',
        })
    })

    it('captures a new $pageview when asPath changes', () => {
        const { rerender } = render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledTimes(1)

        mockRouterState.current = { asPath: '/new-page', pathname: '/new-page', isReady: true }
        rerender(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledTimes(2)
        expect(mockCapture).toHaveBeenLastCalledWith('$pageview', {
            $current_url: 'http://localhost/new-page',
        })
    })

    it('does not capture if posthog client is not available', () => {
        mockUsePostHog.mockReturnValueOnce(null)
        render(<PostHogPageView />)
        expect(mockCapture).not.toHaveBeenCalled()
    })

    it('does not capture if router is not ready', () => {
        mockRouterState.current = { asPath: '/initial', pathname: '/initial', isReady: false }
        render(<PostHogPageView />)
        expect(mockCapture).not.toHaveBeenCalled()
    })

    it('captures pageview once router becomes ready', () => {
        mockRouterState.current = { asPath: '/initial', pathname: '/initial', isReady: false }
        const { rerender } = render(<PostHogPageView />)
        expect(mockCapture).not.toHaveBeenCalled()

        mockRouterState.current = { asPath: '/initial', pathname: '/initial', isReady: true }
        rerender(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledTimes(1)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: 'http://localhost/initial',
        })
    })
})
