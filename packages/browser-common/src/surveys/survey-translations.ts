import type { SurveysRuntimeHost } from '../surveys-runtime-host'
import type { Survey } from '../types/surveys'
import { createLogger } from '../utils/logger'
import { applySurveyTranslation, detectSurveyLanguage } from '@posthog/core/surveys'

const logger = createLogger('[SurveyTranslations]')

/**
 * Detects the user's language using priority order:
 * 1. config.override_display_language (explicit override)
 * 2. person properties 'language' (allows programmatic control via posthog.identify())
 * 3. navigator.language or navigator.userLanguage (browser language)
 *
 * TODO: Consider adding dynamic language change detection in the future:
 * - Listen to 'languagechange' event on window (https://developer.mozilla.org/en-US/docs/Web/API/Window/languagechange_event)
 * - Listen to config changes (once we add config change events to SurveysRuntimeHost core)
 * - Re-render survey when language changes mid-session
 *
 * @param instance - SurveysRuntimeHost instance to retrieve config and person properties
 * @returns The detected language code (e.g., 'fr', 'es', 'en-US') or null if not found
 */
export function detectUserLanguage(instance: SurveysRuntimeHost): string | null {
    return detectSurveyLanguage(
        {
            overrideLanguage: instance.overrideLanguage,
            storedPersonProperties: instance.storedPersonProperties,
            locale:
                typeof navigator !== 'undefined'
                    ? navigator.language || (navigator as Navigator & { userLanguage?: string }).userLanguage
                    : undefined,
        },
        logger
    )
}

/**
 * Applies translations to a survey based on the user's language from person properties
 * @param survey - The original survey object
 * @param instance - SurveysRuntimeHost instance to retrieve person properties
 * @returns An object containing the translated survey and the language used (or null if no translation applied)
 */
export function applySurveyTranslationForUser(
    survey: Survey,
    instance: SurveysRuntimeHost
): { survey: Survey; language: string | null } {
    const userLanguage = detectUserLanguage(instance)

    if (!userLanguage) {
        logger.info('No user language detected')
        return { survey, language: null }
    }

    const result = applySurveyTranslation(survey, userLanguage, logger)

    return {
        survey: result.survey,
        language: result.matchedKey,
    }
}
