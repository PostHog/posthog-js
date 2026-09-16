import { getSurveyIterationKey } from '@posthog/core/surveys'

import type { DisplaySurveyOptions, Survey } from '../types/surveys'
import { SurveyType, DisplaySurveyType } from '../survey-constants'
import { createLogger } from './logger'

export { doesSurveyActivateByEvent, getSurveyInteractionProperty, isSurveyIterationBased } from '@posthog/core/surveys'

export const SURVEY_LOGGER = createLogger('[Surveys]')

// Covers every state in which `capture()` drops events, not only an explicit opt-out: with
// `opt_out_capturing_by_default` a visitor who has not answered the consent banner yet is also
// not captured, and that person made no choice.
export const SURVEY_CAPTURING_DISABLED = 'PostHog is not capturing, so a survey response cannot be recorded'

export function isSurveyRunning(survey: Survey): boolean {
    return !!(survey.start_date && !survey.end_date)
}

export function doesSurveyActivateByAction(survey: Pick<Survey, 'conditions'>): boolean {
    return !!survey.conditions?.actions?.values?.length
}

export const SURVEY_SEEN_PREFIX = 'seenSurvey_'
export const SURVEY_IN_PROGRESS_PREFIX = 'inProgressSurvey_'
export const SURVEY_ABANDONED_PREFIX = 'abandonedSurvey_'

// Prefix namespacing is a browser localStorage concern;
// the iteration-qualified key itself is shared with the other SDKs via @posthog/core.
export const getSurveyStorageKey = (prefix: string, survey: Pick<Survey, 'id' | 'current_iteration'>): string => {
    return `${prefix}${getSurveyIterationKey(survey)}`
}

export const getSurveySeenKey = (survey: Pick<Survey, 'id' | 'current_iteration'>): string => {
    return getSurveyStorageKey(SURVEY_SEEN_PREFIX, survey)
}

export const getSurveyAbandonedKey = (survey: Pick<Survey, 'id' | 'current_iteration'>): string => {
    return getSurveyStorageKey(SURVEY_ABANDONED_PREFIX, survey)
}

export const setSurveySeenOnLocalStorage = (survey: Pick<Survey, 'id' | 'current_iteration'>) => {
    try {
        const surveySeenKey = getSurveySeenKey(survey)
        const isSurveySeen = localStorage.getItem(surveySeenKey)
        // if survey is already seen, no need to set it again
        if (isSurveySeen) {
            return
        }

        localStorage.setItem(surveySeenKey, 'true')
    } catch (error) {
        SURVEY_LOGGER.error('Failed to persist survey seen state', error)
    }
}

// These surveys are relevant for the getActiveMatchingSurveys method. They are used to
// display surveys in our customer's application. Any new in-app survey type should be added here.
export const IN_APP_SURVEY_TYPES: SurveyType[] = [SurveyType.Popover, SurveyType.Widget, SurveyType.API]

export const DEFAULT_DISPLAY_SURVEY_OPTIONS: DisplaySurveyOptions = {
    ignoreConditions: false,
    ignoreDelay: false,
    displayType: DisplaySurveyType.Popover,
}
