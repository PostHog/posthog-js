import { useFeatureFlagPayload, useFeatureFlagVariantKey, usePostHog } from '../hooks'
import React, { useCallback, useEffect, useRef } from 'react'
import { PostHog } from '../context'

export type PostHogFeatureProps = React.HTMLProps<HTMLDivElement> & {
    flag: string
    children: React.ReactNode | ((payload: any) => React.ReactNode)
    fallback?: React.ReactNode
    match?: string | boolean
    visibilityObserverOptions?: IntersectionObserverInit
    trackInteraction?: boolean
    trackView?: boolean
}

export function PostHogFeature({
    flag,
    match,
    children,
    fallback,
    visibilityObserverOptions,
    trackInteraction,
    trackView,
    ...props
}: PostHogFeatureProps): JSX.Element | null {
    const payload = useFeatureFlagPayload(flag)
    const variant = useFeatureFlagVariantKey(flag)

    const shouldTrackInteraction = trackInteraction ?? true
    const shouldTrackView = trackView ?? true

    if (match === undefined || variant === match) {
        const childNode: React.ReactNode = typeof children === 'function' ? children(payload) : children
        return (
            <VisibilityAndClickTracker
                flag={flag}
                options={visibilityObserverOptions}
                trackInteraction={shouldTrackInteraction}
                trackView={shouldTrackView}
                {...props}
            >
                {childNode}
            </VisibilityAndClickTracker>
        )
    }
    return <>{fallback}</>
}

function captureFeatureInteraction(flag: string, posthog: PostHog) {
    posthog.capture('$feature_interaction', { feature_flag: flag, $set: { [`$feature_interaction/${flag}`]: true } })
}

function captureFeatureView(flag: string, posthog: PostHog) {
    posthog.capture('$feature_view', { feature_flag: flag })
}

function VisibilityAndClickTracker({
    flag,
    children,
    trackInteraction,
    trackView,
    options,
    ...props
}: {
    flag: string
    children: React.ReactNode
    trackInteraction: boolean
    trackView: boolean
    options?: IntersectionObserverInit
}): JSX.Element {
    const ref = useRef<HTMLDivElement>(null)
    const posthog = usePostHog()
    const visibilityTrackedRef = useRef(false)
    const clickTrackedRef = useRef(false)

    const cachedOnClick = useCallback(() => {
        if (!clickTrackedRef.current && trackInteraction) {
            captureFeatureInteraction(flag, posthog)
            clickTrackedRef.current = true
        }
    }, [flag, posthog, trackInteraction])

    useEffect(() => {
        if (ref.current === null || !trackView) return

        const onIntersect = (entry: IntersectionObserverEntry) => {
            if (!visibilityTrackedRef.current && entry.isIntersecting) {
                captureFeatureView(flag, posthog)
                visibilityTrackedRef.current = true
            }
        }

        // eslint-disable-next-line compat/compat
        const observer = new IntersectionObserver(([entry]) => onIntersect(entry), {
            threshold: 0.1,
            ...options,
        })
        observer.observe(ref.current)
        return () => observer.disconnect()
    }, [flag, options, posthog, ref, trackView])

    return (
        <div ref={ref} {...props} onClick={cachedOnClick}>
            {children}
        </div>
    )
}
