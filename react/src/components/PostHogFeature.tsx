import { useFeatureFlagPayload, useFeatureFlagVariantKey, usePostHog } from '../hooks'
import React, { RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { PostHog } from '../context'

export type PostHogFeatureProps = {
    flag: string
    children: React.ReactNode | ((payload: any) => React.ReactNode)
    fallback: React.ReactNode
    match?: string | boolean
    visibilityObserverOptions?: IntersectionObserverInit
}

export function PostHogFeature({
    flag,
    match,
    children,
    fallback,
    visibilityObserverOptions,
}: PostHogFeatureProps): JSX.Element | null {
    const payload = useFeatureFlagPayload(flag)
    const variant = useFeatureFlagVariantKey(flag)

    if (match === undefined || variant === match) {
        const childNode: React.ReactNode = typeof children === 'function' ? children(payload) : children
        return (
            <div>
                <VisibilityAndClickTracker flag={flag} options={visibilityObserverOptions}>
                    {childNode}
                </VisibilityAndClickTracker>
            </div>
        )
    }
    return <>{fallback}</>
}

function trackClicks(flag: string, posthog?: PostHog) {
    posthog?.capture('$feature_interaction', { feature_flag: flag, $set: { [`$feature_interaction/${flag}`]: true } })
}

function trackVisibility(flag: string, posthog?: PostHog) {
    posthog?.capture('$feature_view', { feature_flag: flag })
}

function VisibilityAndClickTracker({
    flag,
    children,
    options,
}: {
    flag: string
    children: React.ReactNode
    options?: IntersectionObserverInit
}): JSX.Element {
    const ref = useRef<HTMLDivElement>(null)
    const posthog = usePostHog()
    const [visibilityTracked, setVisibilityTracked] = useState(false)
    const [clickTracked, setClickTracked] = useState(false)

    const isIntersecting = useVisibleOnScreen(ref, {
        threshold: 0.1,
        ...options,
    })

    if (isIntersecting && !visibilityTracked) {
        trackVisibility(flag, posthog)
        setVisibilityTracked(true)
    }

    return (
        <div
            ref={ref}
            onClick={() => {
                if (!clickTracked) {
                    trackClicks(flag, posthog)
                    setClickTracked(true)
                }
            }}
        >
            {children}
        </div>
    )
}

const useVisibleOnScreen = (ref: RefObject<HTMLElement>, options?: IntersectionObserverInit) => {
    const [isIntersecting, setIntersecting] = useState(false)

    const observer = useMemo(
        () => new IntersectionObserver(([entry]) => setIntersecting(entry.isIntersecting), options),
        [ref, options]
    )

    useEffect(() => {
        if (ref.current === null) return

        observer.observe(ref.current)
        return () => observer.disconnect()
    }, [ref])

    return isIntersecting
}
