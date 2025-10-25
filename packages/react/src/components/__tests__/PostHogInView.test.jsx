import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { PostHogProvider } from '../../context'
import { PostHogInView } from '../'
import '@testing-library/jest-dom'

describe('PostHogInView component', () => {
    let mockObserverCallback = null

    let fakePosthog

    beforeEach(() => {
        fakePosthog = {
            capture: jest.fn(),
        }

        const mockIntersectionObserver = jest.fn((callback) => {
            mockObserverCallback = callback
            return {
                observe: jest.fn(),
                unobserve: jest.fn(),
                disconnect: jest.fn(),
            }
        })

        // eslint-disable-next-line compat/compat
        window.IntersectionObserver = mockIntersectionObserver
    })

    it('should render children', () => {
        render(
            <PostHogProvider client={fakePosthog}>
                <PostHogInView name="test-element">
                    <div data-testid="child">Hello</div>
                </PostHogInView>
            </PostHogProvider>
        )

        expect(screen.getByTestId('child')).toBeInTheDocument()
    })

    it('should track when element comes into view', () => {
        render(
            <PostHogProvider client={fakePosthog}>
                <PostHogInView name="test-element">
                    <div data-testid="child">Hello</div>
                </PostHogInView>
            </PostHogProvider>
        )

        expect(fakePosthog.capture).not.toHaveBeenCalled()

        mockObserverCallback([{ isIntersecting: true }])

        expect(fakePosthog.capture).toHaveBeenCalledWith('$element_viewed', {
            element_name: 'test-element',
        })
        expect(fakePosthog.capture).toHaveBeenCalledTimes(1)
    })

    it('should only track visibility once', () => {
        render(
            <PostHogProvider client={fakePosthog}>
                <PostHogInView name="test-element">
                    <div data-testid="child">Hello</div>
                </PostHogInView>
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
                <PostHogInView name="test-element" properties={{ category: 'hero', priority: 'high' }}>
                    <div data-testid="child">Hello</div>
                </PostHogInView>
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
                <PostHogInView name="test-element">
                    <div data-testid="child">Hello</div>
                </PostHogInView>
            </PostHogProvider>
        )

        mockObserverCallback([{ isIntersecting: false }])

        expect(fakePosthog.capture).not.toHaveBeenCalled()
    })
})
