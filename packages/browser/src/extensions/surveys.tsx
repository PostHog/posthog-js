import { useMemo } from 'preact/hooks'
import * as shared from '@posthog/browser-common/surveys-renderer'
import type { PostHog } from '../posthog-core'
import { createSurveysRuntimeHost } from '../utils/surveys-runtime-host'
export { INTRO_SCREEN_PREVIEW_INDEX, getNextSurveyStep } from '@posthog/browser-common/surveys-renderer'
export class SurveyManager extends shared.SurveyManager {
    constructor(instance: PostHog) {
        super(createSurveysRuntimeHost(instance))
    }
}
export const generateSurveys = (instance: PostHog, enabled: boolean | undefined) =>
    shared.generateSurveys(createSurveysRuntimeHost(instance), enabled)
export const renderFeedbackWidgetPreview = (
    options: Omit<Parameters<typeof shared.renderFeedbackWidgetPreview>[0], 'posthog'>
) => shared.renderFeedbackWidgetPreview({ ...options, posthog: createSurveysRuntimeHost() })
export const renderSurveysPreview = (
    options: Omit<Parameters<typeof shared.renderSurveysPreview>[0], 'posthog'> & { posthog?: PostHog }
) => shared.renderSurveysPreview({ ...options, posthog: createSurveysRuntimeHost(options.posthog) })
const useRuntimeHost = (instance?: PostHog) => useMemo(() => createSurveysRuntimeHost(instance), [instance])
export const useHideSurveyOnURLChange = (
    options: Omit<Parameters<typeof shared.useHideSurveyOnURLChange>[0], 'posthog'> & { posthog?: PostHog }
) => shared.useHideSurveyOnURLChange({ ...options, posthog: useRuntimeHost(options.posthog) })
export const SurveyPopup = (
    options: Omit<Parameters<typeof shared.SurveyPopup>[0], 'posthog'> & { posthog?: PostHog }
) => shared.SurveyPopup({ ...options, posthog: useRuntimeHost(options.posthog) })
export const Questions = (options: Omit<Parameters<typeof shared.Questions>[0], 'posthog'> & { posthog?: PostHog }) =>
    shared.Questions({ ...options, posthog: useRuntimeHost(options.posthog) })
export const FeedbackWidget = (
    options: Omit<Parameters<typeof shared.FeedbackWidget>[0], 'posthog'> & { posthog?: PostHog }
) => shared.FeedbackWidget({ ...options, posthog: useRuntimeHost(options.posthog) })
export const usePopupVisibility = (
    survey: Parameters<typeof shared.usePopupVisibility>[0],
    instance: PostHog | undefined,
    ...args: [
        Parameters<typeof shared.usePopupVisibility>[2],
        Parameters<typeof shared.usePopupVisibility>[3],
        Parameters<typeof shared.usePopupVisibility>[4],
        Parameters<typeof shared.usePopupVisibility>[5],
        Parameters<typeof shared.usePopupVisibility>[6]?,
        Parameters<typeof shared.usePopupVisibility>[7]?,
        Parameters<typeof shared.usePopupVisibility>[8]?,
    ]
) => shared.usePopupVisibility(survey, useRuntimeHost(instance), ...args)
