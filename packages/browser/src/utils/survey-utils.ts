import { DisplaySurveyOptions, DisplaySurveyType, Survey, SurveyType } from '../posthog-surveys-types'
import { createLogger } from '../utils/logger'
import { PostHog } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'
import { isFunction, isNullish } from '@posthog/core'

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
export const LAST_SEEN_SURVEY_DATE_KEY = 'lastSeenSurveyDate'

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

export function isPersistenceEnabledWithLocalStorage(
    posthog?: PostHog
): posthog is PostHog & { persistence: PostHogPersistence } {
    if (!posthog?.persistence) {
        return false
    }

    const persistenceSetting = posthog.config?.persistence?.toLowerCase() || ''
    if (!persistenceSetting.includes('localstorage')) {
        return false
    }

    const persistenceIsDisabled = isFunction(posthog.persistence.isDisabled)
        ? posthog.persistence.isDisabled()
        : !!posthog.persistence._disabled

    return !persistenceIsDisabled
}

/**
 * We used to retrieve from localStorage directly. Now, we instead rely on the persistence API, since this is the preferred way to store data.
 * But, since we might have customers that might be using surveys with persistence disabled, we need to fallback to localStorage
 * to maintain backwards compatibility.
 */
export const getFromPersistenceWithLocalStorageFallback = (key: string, posthog?: PostHog) => {
    let value = undefined

    // Try persistence if available
    if (isPersistenceEnabledWithLocalStorage(posthog)) {
        try {
            value = posthog.persistence.get_property(key)
        } catch (e) {
            SURVEY_LOGGER.error('Error getting property from persistence', e)
        }
    }

    // Fall back to localStorage if not found or error
    if (isNullish(value)) {
        try {
            return localStorage.getItem(key)
        } catch (e) {
            SURVEY_LOGGER.error('Error getting property from localStorage', e)
            return null
        }
    }

    return value
}

/**
 * We used to set on localStorage directly. Now, we instead rely on the persistence API, since this is the preferred way to store data.
 * But, since we might have customers that might be using surveys with persistence disabled, we need to fallback to localStorage
 * to maintain backwards compatibility.
 */
export const setOnPersistenceWithLocalStorageFallback = (key: string, value: any, posthog?: PostHog) => {
    if (!isPersistenceEnabledWithLocalStorage(posthog)) {
        try {
            localStorage.setItem(key, value)
        } catch (e) {
            SURVEY_LOGGER.error('Error setting property on localStorage', e)
        }

        return
    }

    try {
        posthog.persistence.set_property(key, value)
    } catch (e) {
        SURVEY_LOGGER.error('Error setting property on persistence', e)
    }
}

/**
 * When removing a property from persistence, remove from localStorage for backwards compatibility.
 */
export const clearFromPersistenceWithLocalStorageFallback = (key: string, posthog?: PostHog) => {
    if (!isPersistenceEnabledWithLocalStorage(posthog)) {
        try {
            localStorage.removeItem(key)
        } catch (e) {
            SURVEY_LOGGER.error('Error clearing property from localStorage', e)
        }

        return
    }

    try {
        posthog.persistence.unregister(key)
    } catch (e) {
        SURVEY_LOGGER.error('Error clearing property from persistence', e)
    }
}

export const setSurveySeenOnLocalStorage = (survey: Pick<Survey, 'id' | 'current_iteration'>, posthog?: PostHog) => {
    const isSurveySeen = getFromPersistenceWithLocalStorageFallback(getSurveySeenKey(survey), posthog)
    if (isSurveySeen) {
        return
    }

    setOnPersistenceWithLocalStorageFallback(getSurveySeenKey(survey), true, posthog)
}

// These surveys are relevant for the getActiveMatchingSurveys method. They are used to
// display surveys in our customer's application. Any new in-app survey type should be added here.
export const IN_APP_SURVEY_TYPES = [SurveyType.Popover, SurveyType.Widget, SurveyType.API]

export const DEFAULT_DISPLAY_SURVEY_OPTIONS: DisplaySurveyOptions = {
    ignoreConditions: false,
    ignoreDelay: false,
    displayType: DisplaySurveyType.Popover,
}
