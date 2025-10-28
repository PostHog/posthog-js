import React, { MouseEventHandler, useEffect, useMemo, useRef } from 'react'
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

    const observerOptions = useMemo(
        () => ({
            threshold: 0.1,
            ...options,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [options?.threshold, options?.root, options?.rootMargin]
    )

    useEffect(() => {
        if (isNull(ref.current) || !trackView) return

        // eslint-disable-next-line compat/compat
        const observer = new IntersectionObserver(([entry]) => onIntersect(entry), observerOptions)
        observer.observe(ref.current)
        return () => observer.disconnect()
    }, [observerOptions, trackView, onIntersect])

    return (
        <div ref={ref} {...props} onClick={onClick}>
            {children}
        </div>
    )
}
