import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { PostHog, PostHogProvider } from '../../context'
import { PostHogCaptureOnViewed } from '../'
import '@testing-library/jest-dom'

describe('PostHogCaptureOnViewed component', () => {
    let mockObserverCallback: any = null

    let fakePosthog: PostHog
    const mockIntersectionObserver = vi.fn()
    const observe = vi.fn()
    const disconnect = vi.fn()
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    beforeEach(() => {
        fakePosthog = {
            capture: vi.fn(),
        } as unknown as PostHog

        mockIntersectionObserver.mockImplementation((callback) => {
            mockObserverCallback = callback
            return {
                observe,
                unobserve: vi.fn(),
                disconnect,
            }
        })

        mockIntersectionObserver.prototype = {}
        vi.stubGlobal('IntersectionObserver', mockIntersectionObserver)
    })

    it('should render children', () => {
        render(
            <PostHogProvider client={fakePosthog}>
                <PostHogCaptureOnViewed name="test-element">
                    <div data-testid="child">Hello</div>
                </PostHogCaptureOnViewed>
            </PostHogProvider>
        )

        expect(screen.getByTestId('child')).toBeInTheDocument()
    })

    it('should track when element comes into view', () => {
        const { unmount } = render(
            <PostHogProvider client={fakePosthog}>
                <PostHogCaptureOnViewed name="test-element">
                    <div data-testid="child">Hello</div>
                </PostHogCaptureOnViewed>
            </PostHogProvider>
        )

        expect(observe).toHaveBeenCalledWith(screen.getByTestId('child').parentElement)
        expect(mockIntersectionObserver).toHaveBeenCalledWith(expect.any(Function), { threshold: 0.1 })
        expect(fakePosthog.capture).not.toHaveBeenCalled()

        mockObserverCallback([{ isIntersecting: true }])

        expect(fakePosthog.capture).toHaveBeenCalledWith('$element_viewed', {
            element_name: 'test-element',
        })
        expect(fakePosthog.capture).toHaveBeenCalledTimes(1)
        unmount()
        expect(disconnect).toHaveBeenCalledTimes(1)
    })

    it('should only track visibility once', () => {
        render(
            <PostHogProvider client={fakePosthog}>
                <PostHogCaptureOnViewed name="test-element">
                    <div data-testid="child">Hello</div>
                </PostHogCaptureOnViewed>
            </PostHogProvider>
        )

        mockObserverCallback([{ isIntersecting: true }])
        expect(fakePosthog.capture).toHaveBeenCalledTimes(1)

        mockObserverCallback([{ isIntersecting: true }])
        mockObserverCallback([{ isIntersecting: true }])
        expect(fakePosthog.capture).toHaveBeenCalledTimes(1)
    })

    it('should include custom properties', () => {
        render(
            <PostHogProvider client={fakePosthog}>
                <PostHogCaptureOnViewed name="test-element" properties={{ category: 'hero', priority: 'high' }}>
                    <div data-testid="child">Hello</div>
                </PostHogCaptureOnViewed>
            </PostHogProvider>
        )

        mockObserverCallback([{ isIntersecting: true }])

        expect(fakePosthog.capture).toHaveBeenCalledWith('$element_viewed', {
            element_name: 'test-element',
            category: 'hero',
            priority: 'high',
        })
    })

    it('should not track when element is not intersecting', () => {
        render(
            <PostHogProvider client={fakePosthog}>
                <PostHogCaptureOnViewed name="test-element">
                    <div data-testid="child">Hello</div>
                </PostHogCaptureOnViewed>
            </PostHogProvider>
        )

        mockObserverCallback([{ isIntersecting: false }])

        expect(fakePosthog.capture).not.toHaveBeenCalled()
    })
})
