import { getSurveyIterationKey } from '@posthog/core/surveys'
import { isFunction, type SurveyResponses } from '@posthog/core'

import type { PostHog } from '../posthog-core'
import { DisplaySurveyOptions, Survey, SurveyType, DisplaySurveyType } from '../posthog-surveys-types'
import { createLogger } from '@posthog/browser-common/utils/logger'

export { doesSurveyActivateByEvent, getSurveyInteractionProperty, isSurveyIterationBased } from '@posthog/core/surveys'

export const SURVEY_LOGGER = createLogger('[Surveys]')

// Covers every state in which `capture()` drops events, not only an explicit opt-out: with
// `opt_out_capturing_by_default` a visitor who has not answered the consent banner yet is also
// not captured, and that person made no choice.
export const SURVEY_CAPTURING_DISABLED = 'PostHog is not capturing, so a survey response cannot be recorded'

/**
 * `is_capturing()` was only added to the core in 1.260.0, and a newly deployed surveys bundle can
 * still be loaded by an older cached core, so calling it directly would throw on every display
 * poll. Fall back to that core's own consent gate: those versions have no cookieless mode, so
 * `!has_opted_out_capturing()` is what `is_capturing()` would return there anyway.
 */
export function isCapturingEnabled(posthog: Pick<PostHog, 'is_capturing' | 'has_opted_out_capturing'>): boolean {
    return isFunction(posthog.is_capturing) ? posthog.is_capturing() : !posthog.has_opted_out_capturing()
}

export function isSurveyRunning(survey: Survey): boolean {
    return !!(survey.start_date && !survey.end_date)
}

export function doesSurveyActivateByAction(survey: Pick<Survey, 'conditions'>): boolean {
    return !!survey.conditions?.actions?.values?.length
}

export const SURVEY_SEEN_PREFIX = 'seenSurvey_'
export const SURVEY_IN_PROGRESS_PREFIX = 'inProgressSurvey_'
export const SURVEY_ABANDONED_PREFIX = 'abandonedSurvey_'

export interface InProgressSurveyState {
    surveySubmissionId: string
    lastQuestionIndex: number
    // Question ids in the order the persisted indices point into. Optional for backwards compat with
    // state written before the order was recorded.
    questionOrder?: string[]
    // Indices the respondent has visited, in order, excluding the current one. Pushed on next, popped on back.
    // Optional for backwards compat with state persisted before the back-navigation feature.
    visitedIndices?: number[]
    responses: SurveyResponses
    surveyLanguage?: string | null
    // Maps question id → the question text displayed when the user answered it. Used so that
    // $survey_questions[].question in sent/dismissed events reflects the language the user saw,
    // not the language active at event-fire time after a mid-session switch.
    questionSnapshots?: Record<string, string>
}

/**
 * Some pages cannot touch localStorage at all. The hosted survey page is served with a `sandbox`
 * CSP that omits `allow-same-origin`, so the document gets an opaque origin and every localStorage
 * access throws; private-mode and storage-blocking browsers behave the same way. The in-progress
 * state is the only channel that carries a URL-prefilled answer, and the question index it advances
 * to, from `renderSurvey` to the question renderer, so losing the write silently re-shows a
 * question the link already answered. This per-page-load copy keeps that state readable. It cannot
 * survive a reload, but neither can localStorage on those pages.
 *
 * It lives here rather than next to its localStorage wrappers so that `reset()` can drop it on
 * logout: partially typed answers must not outlive the respondent's session on a shared device.
 */
export const inMemoryInProgressSurveyState: Record<string, InProgressSurveyState> = {}

export const clearInMemoryInProgressSurveyState = (): void => {
    for (const key of Object.keys(inMemoryInProgressSurveyState)) {
        delete inMemoryInProgressSurveyState[key]
    }
}

// Prefix namespacing is a localStorage concern, so it stays in the browser package;
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
