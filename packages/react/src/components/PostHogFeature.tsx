import { useFeatureFlagPayload, useFeatureFlagVariantKey, usePostHog } from '../hooks'
import React, { Children, ReactNode, useCallback, useEffect, useRef } from 'react'
import { PostHog } from '../context'
import { isFunction, isNull, isUndefined } from '../utils/type-utils'

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

    if (isUndefined(match) || variant === match) {
        const childNode: React.ReactNode = isFunction(children) ? children(payload) : children
        return (
            <VisibilityAndClickTrackers
                flag={flag}
                options={visibilityObserverOptions}
                trackInteraction={shouldTrackInteraction}
                trackView={shouldTrackView}
                {...props}
            >
                {childNode}
            </VisibilityAndClickTrackers>
        )
    }
    return <>{fallback}</>
}

function captureFeatureInteraction({
    flag,
    posthog,
    flagVariant,
}: {
    flag: string
    posthog: PostHog
    flagVariant?: string | boolean
}) {
    const properties: Record<string, any> = {
        feature_flag: flag,
        $set: { [`$feature_interaction/${flag}`]: flagVariant ?? true },
    }
    if (typeof flagVariant === 'string') {
        properties.feature_flag_variant = flagVariant
    }
    posthog.capture('$feature_interaction', properties)
}

function captureFeatureView({
    flag,
    posthog,
    flagVariant,
}: {
    flag: string
    posthog: PostHog
    flagVariant?: string | boolean
}) {
    const properties: Record<string, any> = {
        feature_flag: flag,
        $set: { [`$feature_view/${flag}`]: flagVariant ?? true },
    }
    if (typeof flagVariant === 'string') {
        properties.feature_flag_variant = flagVariant
    }
    posthog.capture('$feature_view', properties)
}

function VisibilityAndClickTracker({
    flag,
    children,
    onIntersect,
    onClick,
    trackView,
    options,
    ...props
}: {
    flag: string
    children: React.ReactNode
    onIntersect: (entry: IntersectionObserverEntry) => void
    onClick: () => void
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
    }, [flag, options, posthog, ref, trackView, onIntersect])

    return (
        <div ref={ref} {...props} onClick={onClick}>
            {children}
        </div>
    )
}

function VisibilityAndClickTrackers({
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
    const clickTrackedRef = useRef(false)
    const visibilityTrackedRef = useRef(false)
    const posthog = usePostHog()
    const variant = useFeatureFlagVariantKey(flag)

    const cachedOnClick = useCallback(() => {
        if (!clickTrackedRef.current && trackInteraction) {
            captureFeatureInteraction({ flag, posthog, flagVariant: variant })
            clickTrackedRef.current = true
        }
    }, [flag, posthog, trackInteraction, variant])

    const onIntersect = (entry: IntersectionObserverEntry) => {
        if (!visibilityTrackedRef.current && entry.isIntersecting) {
            captureFeatureView({ flag, posthog, flagVariant: variant })
            visibilityTrackedRef.current = true
        }
    }

    const trackedChildren = Children.map(children, (child: ReactNode) => {
        return (
            <VisibilityAndClickTracker
                flag={flag}
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
