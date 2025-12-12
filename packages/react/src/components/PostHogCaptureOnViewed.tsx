import React, { Children, useCallback, useRef, JSX } from 'react'
import { usePostHog } from '../hooks'
import { VisibilityAndClickTracker } from './internal/VisibilityAndClickTracker'

export type PostHogCaptureOnViewedProps = React.HTMLProps<HTMLDivElement> & {
    name?: string
    properties?: Record<string, any>
    observerOptions?: IntersectionObserverInit
    trackAllChildren?: boolean
}

function TrackedChild({
    child,
    index,
    name,
    properties,
    observerOptions,
}: {
    child: React.ReactNode
    index: number
    name?: string
    properties?: Record<string, any>
    observerOptions?: IntersectionObserverInit
}): JSX.Element {
    const trackedRef = useRef(false)
    const posthog = usePostHog()

    const onIntersect = useCallback(
        (entry: IntersectionObserverEntry) => {
            if (entry.isIntersecting && !trackedRef.current) {
                posthog.capture('$element_viewed', {
                    element_name: name,
                    child_index: index,
                    ...properties,
                })
                trackedRef.current = true
            }
        },
        [posthog, name, index, properties]
    )

    return (
        <VisibilityAndClickTracker onIntersect={onIntersect} trackView={true} options={observerOptions}>
            {child}
        </VisibilityAndClickTracker>
    )
}

/**
 * PostHogCaptureOnViewed - Track when elements are scrolled into view
 *
 * Wraps any children and automatically sends a `$element_viewed` event to PostHog
 * when the element comes into the viewport. Only fires once per component instance.
 *
 * @example
 * ```tsx
 * <PostHogCaptureOnViewed name="hero-banner">
 *   <div>Important content here</div>
 * </PostHogCaptureOnViewed>
 *
 * // With custom properties
 * <PostHogCaptureOnViewed
 *   name="product-card"
 *   properties={{ product_id: '123', category: 'electronics' }}
 * >
 *   <ProductCard />
 * </PostHogCaptureOnViewed>
 *
 * // With custom intersection observer options
 * <PostHogCaptureOnViewed
 *   name="footer"
 *   observerOptions={{ threshold: 0.5 }}
 * >
 *   <Footer />
 * </PostHogCaptureOnViewed>
 * ```
 */
export function PostHogCaptureOnViewed({
    name,
    properties,
    observerOptions,
    trackAllChildren,
    children,
    ...props
}: PostHogCaptureOnViewedProps): JSX.Element {
    const trackedRef = useRef(false)
    const posthog = usePostHog()

    const onIntersect = useCallback(
        (entry: IntersectionObserverEntry) => {
            if (entry.isIntersecting && !trackedRef.current) {
                posthog.capture('$element_viewed', {
                    element_name: name,
                    ...properties,
                })
                trackedRef.current = true
            }
        },
        [posthog, name, properties]
    )

    // If trackAllChildren is enabled, wrap each child individually
    if (trackAllChildren) {
        const trackedChildren = Children.map(children, (child, index) => {
            return (
                <TrackedChild
                    key={index}
                    child={child}
                    index={index}
                    name={name}
                    properties={properties}
                    observerOptions={observerOptions}
                />
            )
        })

        return <div {...props}>{trackedChildren}</div>
    }

    // Default behavior: track the container as a single element
    return (
        <VisibilityAndClickTracker onIntersect={onIntersect} trackView={true} options={observerOptions} {...props}>
            {children}
        </VisibilityAndClickTracker>
    )
}
