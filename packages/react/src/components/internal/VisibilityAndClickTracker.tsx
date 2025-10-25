import React, { MouseEventHandler, useEffect, useRef } from 'react'
import { usePostHog } from '../../hooks'
import { isNull } from '../../utils/type-utils'

/**
 * VisibilityAndClickTracker is an internal component,
 * its API might change without warning and without being signalled as a breaking change
 *
 */
export function VisibilityAndClickTracker({
    children,
    onIntersect,
    onClick,
    trackView,
    options,
    ...props
}: {
    children: React.ReactNode
    onIntersect: (entry: IntersectionObserverEntry) => void
    onClick?: MouseEventHandler<HTMLDivElement>
    trackView: boolean
    options?: IntersectionObserverInit
}): JSX.Element {
    const ref = useRef<HTMLDivElement>(null)
    const posthog = usePostHog()

    useEffect(() => {
        if (isNull(ref.current) || !trackView) return

        // eslint-disable-next-line compat/compat
        const observer = new IntersectionObserver(([entry]) => onIntersect(entry), {
            threshold: 0.1,
            ...options,
        })
        observer.observe(ref.current)
        return () => observer.disconnect()
    }, [options, posthog, ref, trackView, onIntersect])

    return (
        <div ref={ref} {...props} onClick={onClick}>
            {children}
        </div>
    )
}
