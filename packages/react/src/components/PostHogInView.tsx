import React, { Children, useCallback, useRef } from 'react'
import { usePostHog } from '../hooks'
import { VisibilityAndClickTracker } from './internal/VisibilityAndClickTracker'

export type PostHogInViewProps = React.HTMLProps<HTMLDivElement> & {
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
 * PostHogInView - Track when elements are scrolled into view
 *
 * Wraps any children and automatically sends a `$element_viewed` event to PostHog
 * when the element comes into the viewport. Only fires once per component instance.
 *
 * @example
 * ```tsx
 * <PostHogInView name="hero-banner">
 *   <div>Important content here</div>
 * </PostHogInView>
 *
 * // With custom properties
 * <PostHogInView
 *   name="product-card"
 *   properties={{ product_id: '123', category: 'electronics' }}
 * >
 *   <ProductCard />
 * </PostHogInView>
 *
 * // With custom intersection observer options
 * <PostHogInView
 *   name="footer"
 *   observerOptions={{ threshold: 0.5 }}
 * >
 *   <Footer />
 * </PostHogInView>
 *
 * // Track each child separately
 * <PostHogInView
 *   name="carousel-item"
 *   trackAllChildren
 *   properties={{ carousel_id: 'featured-products' }}
 * >
 *   <CarouselSlide />
 *   <CarouselSlide />
 *   <CarouselSlide />
 * </PostHogInView>
 * ```
 */
export function PostHogInView({
    name,
    properties,
    observerOptions,
    trackAllChildren,
    children,
    ...props
}: PostHogInViewProps): JSX.Element {
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
