import type { PostHog } from '../posthog-core'

/**
 * lightweight in-app widget coordinator
 *
 * current implementation rules:
 * - tours and surveys cannot render if the conversations chat pane is open
 * - tours and surveys are dismissed if the conversations chat pane becomes open
 * - tours and surveys cannot render at the same time
 * - banner "tours" are exempt from all of the above (not blocked, not blocking, and no auto-dismiss)
 */

export function canShowSurvey(posthog: PostHog): boolean {
    if (!posthog.conversations?.isReady()) return false

    const widgetOpen = posthog.conversations?.isWidgetOpen?.() ?? false
    const tourActive = posthog.productTours?.hasActiveTour?.() ?? false
    return !widgetOpen && !tourActive
}

export function canShowTour(posthog: PostHog): boolean {
    if (!posthog.conversations?.isReady()) return false

    const widgetOpen = posthog.conversations?.isWidgetOpen?.() ?? false
    const surveyActive = posthog.surveys?.hasSurveyInFocus?.() ?? false
    return !widgetOpen && !surveyActive
}
