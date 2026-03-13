import React from 'react'
import { render } from '@testing-library/react'
import { PostHogPageView } from '../src/pages/PostHogPageView'

const { mockCapture, mockUsePostHog } = vi.hoisted(() => ({
    mockCapture: vi.fn(),
    mockUsePostHog: vi.fn(() => ({ capture: mockCapture })),
}))

vi.mock('posthog-js/react', () => ({
    usePostHog: () => mockUsePostHog(),
}))

let mockRouter = { asPath: '/initial', isReady: true }
vi.mock('next/router', () => ({
    useRouter: () => mockRouter,
}))

describe('Pages PostHogPageView', () => {
    beforeEach(() => {
        mockCapture.mockClear()
        mockUsePostHog.mockClear()
        mockRouter = { asPath: '/initial', isReady: true }
    })

    it('captures a $pageview event on mount', () => {
        render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: '/initial',
        })
    })

    it('includes query params from asPath', () => {
        mockRouter = { asPath: '/search?q=hello&page=2', isReady: true }
        render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: '/search?q=hello&page=2',
        })
    })

    it('captures a new $pageview when asPath changes', () => {
        const { rerender } = render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledTimes(1)

        mockRouter = { asPath: '/new-page', isReady: true }
        rerender(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledTimes(2)
        expect(mockCapture).toHaveBeenLastCalledWith('$pageview', {
            $current_url: '/new-page',
        })
    })

    it('does not capture if posthog client is not available', () => {
        mockUsePostHog.mockReturnValueOnce(null)
        render(<PostHogPageView />)
        expect(mockCapture).not.toHaveBeenCalled()
    })

    it('does not capture if router is not ready', () => {
        mockRouter = { asPath: '/initial', isReady: false }
        render(<PostHogPageView />)
        expect(mockCapture).not.toHaveBeenCalled()
    })

    it('captures pageview once router becomes ready', () => {
        mockRouter = { asPath: '/initial', isReady: false }
        const { rerender } = render(<PostHogPageView />)
        expect(mockCapture).not.toHaveBeenCalled()

        mockRouter = { asPath: '/initial', isReady: true }
        rerender(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledTimes(1)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: '/initial',
        })
    })
})
