import React, { useEffect, useRef } from 'react'
import { usePostHog } from '../hooks'
import { EarlyAccessFeatureStage } from 'posthog-js'

export interface PostHogFeatureEnrollmentProps extends Omit<React.HTMLProps<HTMLDivElement>, 'ref'> {
    /**
     * Which stages of early access features to display.
     * Defaults to all stages: ['concept', 'alpha', 'beta', 'general-availability']
     */
    stages?: EarlyAccessFeatureStage[]
}

/**
 * A React component that renders the PostHog Feature Enrollment UI.
 * This allows users to opt in/out of early access features.
 *
 * The component renders into a Shadow DOM for style isolation, so it won't
 * be affected by your app's styles and won't leak its styles into your app.
 *
 * @example
 * ```tsx
 * import { PostHogFeatureEnrollment } from '@posthog/react'
 *
 * function SettingsPage() {
 *   return (
 *     <div>
 *       <h1>Settings</h1>
 *       <PostHogFeatureEnrollment />
 *     </div>
 *   )
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Only show beta features
 * <PostHogFeatureEnrollment stages={['beta']} />
 * ```
 */
export function PostHogFeatureEnrollment({ stages, ...props }: PostHogFeatureEnrollmentProps): React.ReactElement {
    const containerRef = useRef<HTMLDivElement>(null)
    const posthog = usePostHog()
    const unmountRef = useRef<(() => void) | null>(null)

    useEffect(() => {
        const container = containerRef.current
        if (!container || !posthog) {
            return
        }

        // Use the renderFeatureEnrollments method on the PostHog instance
        // which delegates to the ship extension
        unmountRef.current = posthog.renderFeatureEnrollments(container, stages)

        return () => {
            if (unmountRef.current) {
                unmountRef.current()
                unmountRef.current = null
            }
        }
    }, [posthog, stages])

    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} {...props} />
}
