import { useFeatureFlagPayload, useFeatureFlagVariantKey, usePostHog } from '../hooks'
import React, { JSX } from 'react'
import { PostHog } from '../context'
import { isFunction, isUndefined } from '../utils/type-utils'
import { VisibilityAndClickTrackers } from './internal/VisibilityAndClickTrackers'

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
    const posthog = usePostHog()

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
                onInteract={() => captureFeatureInteraction({ flag, posthog, flagVariant: variant })}
                onView={() => captureFeatureView({ flag, posthog, flagVariant: variant })}
                {...props}
            >
                {childNode}
            </VisibilityAndClickTrackers>
        )
    }
    return <>{fallback}</>
}

export function captureFeatureInteraction({
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

export function captureFeatureView({
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
