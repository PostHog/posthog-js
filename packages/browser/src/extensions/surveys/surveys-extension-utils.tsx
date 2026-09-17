import * as shared from '@posthog/browser-common/surveys/surveys-extension-utils'
import type { PostHog } from '../../posthog-core'
import { createSurveysRuntimeHost, surveyStorage } from '../../utils/surveys-runtime-host'
export {
    getFontFamily,
    getSurveyResponseKey,
    defaultSurveyAppearance,
    addSurveyCSSVariablesToElement,
    hex2rgb,
    hexToRgba,
    getContrastingTextColor,
    shuffle,
    getDisplayOrderChoices,
    getQuestionOrder,
    getDisplayOrderQuestions,
    SurveyContext,
    useSurveyContext,
    renderChildrenAsTextOrHtml,
    doesSurveyDeviceTypesMatch,
    doesSurveyMatchSelector,
    getSurveyContainerClass,
    getPopoverPosition,
} from '@posthog/browser-common/surveys/surveys-extension-utils'
export const getSurveyStylesheet = (instance?: PostHog) =>
    shared.getSurveyStylesheet(createSurveysRuntimeHost(instance))
export const retrieveSurveyShadow = (
    survey: Parameters<typeof shared.retrieveSurveyShadow>[0],
    instance?: PostHog,
    element?: Element
) => shared.retrieveSurveyShadow(survey, createSurveysRuntimeHost(instance), element)
export const sendSurveyEvent = (
    options: Omit<Parameters<typeof shared.sendSurveyEvent>[0], 'posthog'> & { posthog?: PostHog }
) =>
    shared.sendSurveyEvent({
        ...options,
        posthog: options.posthog ? createSurveysRuntimeHost(options.posthog) : undefined,
    })
export const dismissedSurveyEvent = (
    survey: Parameters<typeof shared.dismissedSurveyEvent>[0],
    instance?: PostHog,
    isPreviewMode?: boolean,
    language?: string | null
) =>
    shared.dismissedSurveyEvent(
        survey,
        instance ? createSurveysRuntimeHost(instance) : undefined,
        isPreviewMode,
        language
    )
export const sendSurveyAbandonedEvent = (
    survey: Parameters<typeof shared.sendSurveyAbandonedEvent>[0],
    instance?: PostHog
) => shared.sendSurveyAbandonedEvent(survey, instance ? createSurveysRuntimeHost(instance) : undefined)
export const doesSurveyUrlMatch = (survey: Parameters<typeof shared.doesSurveyUrlMatch>[0], instance?: PostHog) =>
    shared.doesSurveyUrlMatch(survey, createSurveysRuntimeHost(instance))
export const getSurveySeen = (value: Parameters<typeof shared.getSurveySeen>[0]) =>
    shared.getSurveySeen(value, surveyStorage)
export const hasWaitPeriodPassed = (value: Parameters<typeof shared.hasWaitPeriodPassed>[0]) =>
    shared.hasWaitPeriodPassed(value, surveyStorage)
export const getInProgressSurveyState = (
    value: Parameters<typeof shared.getInProgressSurveyState>[0]
): ReturnType<typeof shared.getInProgressSurveyState> => shared.getInProgressSurveyState(value, surveyStorage)
export const isSurveyInProgress = (value: Parameters<typeof shared.isSurveyInProgress>[0]) =>
    shared.isSurveyInProgress(value, surveyStorage)
export const clearInProgressSurveyState = (value: Parameters<typeof shared.clearInProgressSurveyState>[0]) =>
    shared.clearInProgressSurveyState(value, surveyStorage)
export const setInProgressSurveyState = (
    survey: Parameters<typeof shared.setInProgressSurveyState>[0],
    state: Parameters<typeof shared.setInProgressSurveyState>[1]
) => shared.setInProgressSurveyState(survey, state, surveyStorage)
export const canActivateRepeatedly = (survey: Parameters<typeof shared.canActivateRepeatedly>[0]) =>
    shared.canActivateRepeatedly(survey, surveyStorage)
