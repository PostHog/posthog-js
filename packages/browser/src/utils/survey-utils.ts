import { DisplaySurveyOptions, DisplaySurveyType, Survey, SurveyType } from '../posthog-surveys-types'
import { createLogger } from '../utils/logger'

export const SURVEY_LOGGER = createLogger('[Surveys]')

export function isSurveyRunning(survey: Survey): boolean {
    return !!(survey.start_date && !survey.end_date)
}

export function doesSurveyActivateByEvent(survey: Pick<Survey, 'conditions'>): boolean {
    return !!survey.conditions?.events?.values?.length
}

export function doesSurveyActivateByAction(survey: Pick<Survey, 'conditions'>): boolean {
    return !!survey.conditions?.actions?.values?.length
}

export const SURVEY_SEEN_PREFIX = 'seenSurvey_'
export const SURVEY_IN_PROGRESS_PREFIX = 'inProgressSurvey_'

export const getSurveyInteractionProperty = (
    survey: Pick<Survey, 'id' | 'current_iteration'>,
    action: 'responded' | 'dismissed'
): string => {
    let surveyProperty = `$survey_${action}/${survey.id}`
    if (survey.current_iteration && survey.current_iteration > 0) {
        surveyProperty = `$survey_${action}/${survey.id}/${survey.current_iteration}`
    }

    return surveyProperty
}

export const getSurveySeenKey = (survey: Pick<Survey, 'id' | 'current_iteration'>): string => {
    let surveySeenKey = `${SURVEY_SEEN_PREFIX}${survey.id}`
    if (survey.current_iteration && survey.current_iteration > 0) {
        surveySeenKey = `${SURVEY_SEEN_PREFIX}${survey.id}_${survey.current_iteration}`
    }

    return surveySeenKey
}

export const setSurveySeenOnLocalStorage = (survey: Pick<Survey, 'id' | 'current_iteration'>) => {
    const isSurveySeen = localStorage.getItem(getSurveySeenKey(survey))
    // if survey is already seen, no need to set it again
    if (isSurveySeen) {
        return
    }

    localStorage.setItem(getSurveySeenKey(survey), 'true')
}

// These surveys are relevant for the getActiveMatchingSurveys method. They are used to
// display surveys in our customer's application. Any new in-app survey type should be added here.
export const IN_APP_SURVEY_TYPES = [SurveyType.Popover, SurveyType.Widget, SurveyType.API]

export const DEFAULT_DISPLAY_SURVEY_OPTIONS: DisplaySurveyOptions = {
    ignoreConditions: false,
    ignoreDelay: false,
    displayType: DisplaySurveyType.Popover,
}
