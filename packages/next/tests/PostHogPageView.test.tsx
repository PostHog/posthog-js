import React from 'react'
import { render } from '@testing-library/react'
import { PostHogPageView } from '../src/client/PostHogPageView'

const mockCapture = jest.fn()
const mockUsePostHog = jest.fn(() => ({ capture: mockCapture }))
jest.mock('@posthog/react', () => ({
    usePostHog: () => mockUsePostHog(),
}))

let mockPathname = '/initial'
let mockSearchParams = new URLSearchParams()
let mockParams: Record<string, string | string[] | undefined> = {}
jest.mock('next/navigation.js', () => ({
    usePathname: () => mockPathname,
    useSearchParams: () => mockSearchParams,
    useParams: () => mockParams,
}))

describe('PostHogPageView', () => {
    beforeEach(() => {
        mockCapture.mockClear()
        mockUsePostHog.mockClear()
        mockPathname = '/initial'
        mockSearchParams = new URLSearchParams()
        mockParams = {}
    })

    it('captures a $pageview event on mount', () => {
        render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: 'http://localhost/initial',
        })
    })

    it('includes search params in the captured URL', () => {
        mockSearchParams = new URLSearchParams('q=hello&page=2')
        render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: 'http://localhost/initial?q=hello&page=2',
        })
    })

    it.each([
        ['a dynamic segment', '/users/123', { id: '123' }, '/users/[id]'],
        [
            'multiple dynamic segments',
            '/users/123/posts/456',
            { userId: '123', postId: '456' },
            '/users/[userId]/posts/[postId]',
        ],
        ['a catch-all segment', '/docs/guides/setup', { slug: ['guides', 'setup'] }, '/docs/[...slug]'],
        ['an encoded segment', '/users/Jane%20Doe', { name: 'Jane Doe' }, '/users/[name]'],
    ])('captures the route template for %s', (_description, pathname, params, expectedTemplate) => {
        mockPathname = pathname
        mockParams = params
        mockSearchParams = new URLSearchParams('ref=test')

        render(<PostHogPageView captureRouteTemplate />)

        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: `http://localhost${pathname}?ref=test`,
            $pathname: expectedTemplate,
        })
    })

    it('keeps the concrete pathname when the route template is ambiguous', () => {
        mockPathname = '/blog/blog'
        mockParams = { slug: 'blog' }

        render(<PostHogPageView captureRouteTemplate />)

        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: 'http://localhost/blog/blog',
        })
    })

    it('captures a new $pageview when pathname changes', () => {
        const { rerender } = render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledTimes(1)

        mockPathname = '/new-page'
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
})
