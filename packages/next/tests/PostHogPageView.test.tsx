import React from 'react'
import { render } from '@testing-library/react'
import { PostHogPageView } from '../src/client/PostHogPageView'

const mockCapture = jest.fn()
const mockUsePostHog = jest.fn(() => ({ capture: mockCapture }))
jest.mock('posthog-js/react', () => ({
    usePostHog: () => mockUsePostHog(),
}))

let mockPathname = '/initial'
let mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
    usePathname: () => mockPathname,
    useSearchParams: () => mockSearchParams,
}))

describe('PostHogPageView', () => {
    beforeEach(() => {
        mockCapture.mockClear()
        mockUsePostHog.mockClear()
        mockPathname = '/initial'
        mockSearchParams = new URLSearchParams()
    })

    it('captures a $pageview event on mount', () => {
        render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: '/initial',
        })
    })

    it('includes search params in the captured URL', () => {
        mockSearchParams = new URLSearchParams('q=hello&page=2')
        render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: '/initial?q=hello&page=2',
        })
    })

    it('captures a new $pageview when pathname changes', () => {
        const { rerender } = render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledTimes(1)

        mockPathname = '/new-page'
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
})
