import * as shared from '@posthog/browser-common/surveys-renderer'
import { getSurveyRenderContext } from '../browser-surveys'
import type { PostHog } from '../posthog-core'
export { getNextSurveyStep, INTRO_SCREEN_PREVIEW_INDEX } from '@posthog/browser-common/surveys-renderer'
export const renderFeedbackWidgetPreview = (
    options: Omit<Parameters<typeof shared.renderFeedbackWidgetPreview>[0], 'posthog'>
) => shared.renderFeedbackWidgetPreview({ ...options, posthog: getSurveyRenderContext() })
export const renderSurveysPreview = (
    options: Omit<Parameters<typeof shared.renderSurveysPreview>[0], 'posthog'> & { posthog?: PostHog }
) => shared.renderSurveysPreview({ ...options, posthog: getSurveyRenderContext(options.posthog) })
