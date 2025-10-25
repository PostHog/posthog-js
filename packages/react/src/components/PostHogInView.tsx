import React, { useRef } from 'react'
import { usePostHog } from '../hooks'
import { VisibilityAndClickTracker } from './internal/VisibilityAndClickTracker'

export type PostHogInViewProps = React.HTMLProps<HTMLDivElement> & {
    name?: string
    properties?: Record<string, any>
    observerOptions?: IntersectionObserverInit
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
 * ```
 */
export function PostHogInView({
    name,
    properties,
    observerOptions,
    children,
    ...props
}: PostHogInViewProps): JSX.Element {
    const trackedRef = useRef(false)
    const posthog = usePostHog()

    const onIntersect = (entry: IntersectionObserverEntry) => {
        if (entry.isIntersecting && !trackedRef.current) {
            posthog.capture('$element_viewed', {
                element_name: name,
                ...properties,
            })
            trackedRef.current = true
        }
    }

    return (
        <VisibilityAndClickTracker onIntersect={onIntersect} trackView={true} options={observerOptions} {...props}>
            {children}
        </VisibilityAndClickTracker>
    )
}
