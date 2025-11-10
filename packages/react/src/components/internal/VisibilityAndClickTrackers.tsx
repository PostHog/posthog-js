import React, { Children, ReactNode, useCallback, useRef } from 'react'
import { VisibilityAndClickTracker } from './VisibilityAndClickTracker'

/**
 * VisibilityAndClickTrackers is an internal component,
 * its API might change without warning and without being signalled as a breaking change
 *
 * Wraps each of the children passed to it for visiblity and click tracking
 *
 */
export function VisibilityAndClickTrackers({
    children,
    trackInteraction,
    trackView,
    options,
    onInteract,
    onView,
    ...props
}: {
    flag: string
    children: React.ReactNode
    trackInteraction: boolean
    trackView: boolean
    options?: IntersectionObserverInit
    onInteract?: () => void
    onView?: () => void
}): JSX.Element {
    const clickTrackedRef = useRef(false)
    const visibilityTrackedRef = useRef(false)

    const cachedOnClick = useCallback(() => {
        if (!clickTrackedRef.current && trackInteraction && onInteract) {
            onInteract()
            clickTrackedRef.current = true
        }
    }, [trackInteraction, onInteract])

    const onIntersect = (entry: IntersectionObserverEntry) => {
        if (!visibilityTrackedRef.current && entry.isIntersecting && onView) {
            onView()
            visibilityTrackedRef.current = true
        }
    }

    const trackedChildren = Children.map(children, (child: ReactNode) => {
        return (
            <VisibilityAndClickTracker
                onClick={cachedOnClick}
                onIntersect={onIntersect}
                trackView={trackView}
                options={options}
                {...props}
            >
                {child}
            </VisibilityAndClickTracker>
        )
    })

    return <>{trackedChildren}</>
}
