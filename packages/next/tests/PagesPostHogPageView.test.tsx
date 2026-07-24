import React from 'react'
import { render } from '@testing-library/react'
import { PostHogPageView } from '../src/pages/PostHogPageView'

const mockCapture = jest.fn()
const mockUsePostHog = jest.fn(() => ({ capture: mockCapture, config: { disable_capture_url_hashes: false } }))
jest.mock('@posthog/react', () => ({
    usePostHog: () => mockUsePostHog(),
}))

let mockRouter = { asPath: '/initial', isReady: true }
jest.mock('next/router.js', () => ({
    useRouter: () => mockRouter,
}))

describe('Pages PostHogPageView', () => {
    beforeEach(() => {
        mockCapture.mockClear()
        mockUsePostHog.mockReset()
        mockUsePostHog.mockReturnValue({ capture: mockCapture, config: { disable_capture_url_hashes: false } })
        mockRouter = { asPath: '/initial', isReady: true }
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
        mockRouter = { asPath: '/search?q=hello&page=2#section', isReady: true }
        render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: expectedUrl,
        })
    })

    it('captures a new $pageview when asPath changes', () => {
        const { rerender } = render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledTimes(1)

        mockRouter = { asPath: '/new-page', isReady: true }
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
            $current_url: 'http://localhost/initial',
        })
    })
})
