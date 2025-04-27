import { Survey } from '../posthog-surveys-types'
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
