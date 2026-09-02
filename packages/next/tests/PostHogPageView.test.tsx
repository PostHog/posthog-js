import React from 'react'
import { render } from '@testing-library/react'
import { PostHogPageView } from '../src/client/PostHogPageView'

const { mockCapture, mockUsePostHog, mockNavigation } = vi.hoisted(() => {
    const mockCapture = vi.fn()
    return {
        mockCapture,
        mockUsePostHog: vi.fn(() => ({ capture: mockCapture })),
        mockNavigation: {
            pathname: '/initial',
            searchParams: new URLSearchParams(),
            params: {} as Record<string, string | string[] | undefined>,
            useParams: undefined as (() => Record<string, string | string[] | undefined>) | undefined,
        },
    }
})
mockNavigation.useParams = () => mockNavigation.params

vi.mock('@posthog/react', () => ({
    usePostHog: () => mockUsePostHog(),
}))

vi.mock('next/navigation.js', () => ({
    usePathname: () => mockNavigation.pathname,
    useSearchParams: () => mockNavigation.searchParams,
    get useParams() {
        return mockNavigation.useParams
    },
}))

describe('PostHogPageView', () => {
    beforeEach(() => {
        mockCapture.mockClear()
        mockUsePostHog.mockClear()
        mockNavigation.pathname = '/initial'
        mockNavigation.searchParams = new URLSearchParams()
        mockNavigation.params = {}
        mockNavigation.useParams = () => mockNavigation.params
    })

    it('captures a $pageview event on mount', () => {
        render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: 'http://localhost/initial',
        })
    })

    it('includes search params in the captured URL', () => {
        mockNavigation.searchParams = new URLSearchParams('q=hello&page=2')
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
        mockNavigation.pathname = pathname
        mockNavigation.params = params
        mockNavigation.searchParams = new URLSearchParams('ref=test')

        render(<PostHogPageView captureRouteTemplate />)

        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: `http://localhost${pathname}?ref=test`,
            $route: expectedTemplate,
        })
    })

    it('omits the route template when it is ambiguous', () => {
        mockNavigation.pathname = '/orgs/1/projects/1'
        mockNavigation.params = { orgId: '1', projectId: '1' }

        render(<PostHogPageView captureRouteTemplate />)

        expect(mockCapture).toHaveBeenCalledWith('$pageview', {
            $current_url: 'http://localhost/orgs/1/projects/1',
        })
    })

    it('falls back to ordinary pageview capture when useParams is unavailable', () => {
        mockNavigation.useParams = undefined
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation()

        try {
            const { rerender } = render(<PostHogPageView captureRouteTemplate />)
            rerender(<PostHogPageView captureRouteTemplate />)

            expect(mockCapture).toHaveBeenCalledWith('$pageview', {
                $current_url: 'http://localhost/initial',
            })
            expect(consoleWarn).toHaveBeenCalledTimes(1)
            expect(consoleWarn).toHaveBeenCalledWith(
                '[PostHog Next.js] captureRouteTemplate requires Next.js 13.3 or later. Capturing pageview without $route.'
            )
        } finally {
            consoleWarn.mockRestore()
        }
    })

    it('captures a new $pageview when pathname changes', () => {
        const { rerender } = render(<PostHogPageView />)
        expect(mockCapture).toHaveBeenCalledTimes(1)

        mockNavigation.pathname = '/new-page'
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
