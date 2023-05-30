import { useFeatureFlagPayload, useFeatureFlagVariantKey, usePostHog } from '../hooks'
import React, { useCallback, useEffect, useRef } from 'react'
import { PostHog } from '../context'

export type PostHogFeatureProps = React.HTMLProps<HTMLDivElement> & {
    flag: string
    children: React.ReactNode | ((payload: any) => React.ReactNode)
    fallback?: React.ReactNode
    match?: string | boolean
    visibilityObserverOptions?: IntersectionObserverInit
}

export function PostHogFeature({
    flag,
    match,
    children,
    fallback,
    visibilityObserverOptions,
    ...props
}: PostHogFeatureProps): JSX.Element | null {
    const payload = useFeatureFlagPayload(flag)
    const variant = useFeatureFlagVariantKey(flag)

    if (match === undefined || variant === match) {
        const childNode: React.ReactNode = typeof children === 'function' ? children(payload) : children
        return (
            <VisibilityAndClickTracker flag={flag} options={visibilityObserverOptions} {...props}>
                {childNode}
            </VisibilityAndClickTracker>
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
    ...props
}: {
    flag: string
    children: React.ReactNode
    options?: IntersectionObserverInit
}): JSX.Element {
    const ref = useRef<HTMLDivElement>(null)
    const posthog = usePostHog()
    const visibilityTrackedRef = useRef(false)
    const clickTrackedRef = useRef(false)

    const cachedOnClick = useCallback(() => {
        if (!clickTrackedRef.current) {
            trackClicks(flag, posthog)
            clickTrackedRef.current = true
        }
    }, [flag, posthog])

    useEffect(() => {
        if (ref.current === null) return

        const onIntersect = (entry: IntersectionObserverEntry) => {
            if (!visibilityTrackedRef.current && entry.isIntersecting) {
                trackVisibility(flag, posthog)
                visibilityTrackedRef.current = true
            }
        }

        const observer = new IntersectionObserver(([entry]) => onIntersect(entry), {
            threshold: 0.1,
            ...options,
        })
        observer.observe(ref.current)
        return () => observer.disconnect()
    }, [flag, options, posthog, ref])

    return (
        <div ref={ref} {...props} onClick={cachedOnClick}>
            {children}
        </div>
    )
}
