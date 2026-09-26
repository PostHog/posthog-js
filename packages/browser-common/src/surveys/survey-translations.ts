import { STORED_PERSON_PROPERTIES_KEY } from '../constants'
import type { Properties } from '@posthog/types'
import type { SurveyRenderContext } from '../survey-render-context'
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
 * @param instance - SurveyRenderContext instance to retrieve config and person properties
 * @returns The detected language code (e.g., 'fr', 'es', 'en-US') or null if not found
 */
export function detectUserLanguage(instance: SurveyRenderContext): string | null {
    return detectSurveyLanguage(
        {
            overrideLanguage: instance.config.overrideLanguage,
            storedPersonProperties: instance.client?.kv.get<Properties>(STORED_PERSON_PROPERTIES_KEY),
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
 * @param instance - SurveyRenderContext instance to retrieve person properties
 * @returns An object containing the translated survey and the language used (or null if no translation applied)
 */
export function applySurveyTranslationForUser(
    survey: Survey,
    instance: SurveyRenderContext
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
