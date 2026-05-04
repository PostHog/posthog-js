import { PostHog } from '../posthog-core'
import { Survey } from '../posthog-surveys-types'
import { STORED_PERSON_PROPERTIES_KEY } from '../constants'
import { createLogger } from './logger'
import { getBrowserLanguage } from './event-utils'
import { isFunction } from '@posthog/core'
import { applySurveyTranslation, detectSurveyLanguage } from '@posthog/core/surveys'

const logger = createLogger('[SurveyTranslations]')

/**
 * Detects the user's language using priority order:
 * 1. config.override_display_language (explicit override)
 * 2. person properties 'language' (allows programmatic control via posthog.identify())
 * 3. navigator.language (browser language)
 *
 * TODO: Consider adding dynamic language change detection in the future:
 * - Listen to 'languagechange' event on window (https://developer.mozilla.org/en-US/docs/Web/API/Window/languagechange_event)
 * - Listen to config changes (once we add config change events to PostHog core)
 * - Re-render survey when language changes mid-session
 *
 * @param instance - PostHog instance to retrieve config and person properties
 * @returns The detected language code (e.g., 'fr', 'es', 'en-US') or null if not found
 */
export function detectUserLanguage(instance: PostHog): string | null {
    return detectSurveyLanguage({
        overrideLanguage: instance.config.override_display_language,
        storedPersonProperties: isFunction(instance.get_property)
            ? instance.get_property(STORED_PERSON_PROPERTIES_KEY)
            : undefined,
        locale: getBrowserLanguage(),
    })
}

/**
 * Applies translations to a survey based on the user's language from person properties
 * @param survey - The original survey object
 * @param instance - PostHog instance to retrieve person properties
 * @returns An object containing the translated survey and the language used (or null if no translation applied)
 */
export function applySurveyTranslationForUser(
    survey: Survey,
    instance: PostHog
): { survey: Survey; language: string | null } {
    const userLanguage = detectUserLanguage(instance)

    if (!userLanguage) {
        logger.info('No user language detected')
        return { survey, language: null }
    }

    const result = applySurveyTranslation(survey, userLanguage)

    return {
        survey: result.survey,
        language: result.matchedKey,
    }
}
