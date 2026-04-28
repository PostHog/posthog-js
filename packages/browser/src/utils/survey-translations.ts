import { PostHog } from '../posthog-core'
import { Survey, SurveyQuestion, SurveyQuestionTranslation, SurveyTranslation } from '../posthog-surveys-types'
import { STORED_PERSON_PROPERTIES_KEY } from '../constants'
import { createLogger } from './logger'
import { getBrowserLanguage } from './event-utils'
import { findBestTranslationMatch } from './language-utils'
import { isArray, isFunction, isUndefined } from '@posthog/core'

const logger = createLogger('[SurveyTranslations]')

function getLanguageFromStoredPersonProperties(storedPersonProperties: unknown): string | null {
    if (
        !storedPersonProperties ||
        typeof storedPersonProperties !== 'object' ||
        !('language' in storedPersonProperties)
    ) {
        return null
    }

    const personLanguage = storedPersonProperties.language
    return typeof personLanguage === 'string' && personLanguage.trim() ? personLanguage.trim() : null
}

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
    const configLanguage = instance.config.override_display_language
    if (configLanguage) {
        logger.info(`Using config.override_display_language: ${configLanguage}`)
        return configLanguage
    }

    const personLanguage = getLanguageFromStoredPersonProperties(
        isFunction(instance.get_property) ? instance.get_property(STORED_PERSON_PROPERTIES_KEY) : undefined
    )
    if (personLanguage) {
        logger.info(`Using person property language: ${personLanguage}`)
        return personLanguage
    }

    const browserLanguage = getBrowserLanguage()
    if (browserLanguage) {
        logger.info(`Using browser language: ${browserLanguage}`)
        return browserLanguage
    }

    logger.info('No user language detected')
    return null
}

/**
 * Merges translated question fields on top of default question fields
 * @param question - The original question object
 * @param targetLanguage - The target language code
 * @returns An object with the translated question and the matched language key
 */
function mergeQuestionTranslation(
    question: SurveyQuestion,
    targetLanguage: string
): { question: SurveyQuestion; matchedKey: string | null; hasChanges: boolean } {
    const translationKey = findBestTranslationMatch(question.translations, targetLanguage)
    if (!translationKey) {
        return { question, matchedKey: null, hasChanges: false }
    }

    const questionTranslation = question.translations?.[translationKey]
    if (!questionTranslation) {
        return { question, matchedKey: null, hasChanges: false }
    }

    const translated: SurveyQuestion = { ...question }
    let hasChanges = false

    if (!isUndefined(questionTranslation.question)) {
        translated.question = questionTranslation.question
        hasChanges = true
    }
    if (!isUndefined(questionTranslation.description)) {
        translated.description = questionTranslation.description
        hasChanges = true
    }
    if (!isUndefined(questionTranslation.buttonText)) {
        translated.buttonText = questionTranslation.buttonText
        hasChanges = true
    }

    if ('link' in translated && !isUndefined(questionTranslation.link)) {
        translated.link = questionTranslation.link
        hasChanges = true
    }

    if ('lowerBoundLabel' in translated && !isUndefined(questionTranslation.lowerBoundLabel)) {
        translated.lowerBoundLabel = questionTranslation.lowerBoundLabel
        hasChanges = true
    }
    if ('upperBoundLabel' in translated && !isUndefined(questionTranslation.upperBoundLabel)) {
        translated.upperBoundLabel = questionTranslation.upperBoundLabel
        hasChanges = true
    }

    if ('choices' in translated && isTranslatedChoices(questionTranslation)) {
        translated.choices = questionTranslation.choices
        hasChanges = true
    }

    return {
        question: hasChanges ? translated : question,
        matchedKey: hasChanges ? translationKey : null,
        hasChanges,
    }
}

function isTranslatedChoices(
    questionTranslation: SurveyQuestionTranslation
): questionTranslation is SurveyQuestionTranslation & { choices: string[] } {
    return isArray(questionTranslation.choices)
}

function hasThankYouTranslation(translation: SurveyTranslation): boolean {
    return (
        !isUndefined(translation.thankYouMessageHeader) ||
        !isUndefined(translation.thankYouMessageDescription) ||
        !isUndefined(translation.thankYouMessageCloseButtonText)
    )
}

/**
 * Applies translations to a survey based on the target language
 * @param survey - The original survey object
 * @param targetLanguage - The target language code
 * @returns An object with the translated survey and the matched language key (or null if no match)
 */
export function applySurveyTranslation(
    survey: Survey,
    targetLanguage: string
): { survey: Survey; matchedKey: string | null } {
    const translationKey = findBestTranslationMatch(survey.translations, targetLanguage)

    const translated = { ...survey }
    let hasTranslation = false

    if (translationKey) {
        const translation = survey.translations?.[translationKey]
        if (translation) {
            logger.info(`Applying survey-level translation for language: ${translationKey}`)

            if (!isUndefined(translation.name)) {
                translated.name = translation.name
                hasTranslation = true
            }

            if (translated.appearance) {
                translated.appearance = { ...translated.appearance }

                if (!isUndefined(translation.thankYouMessageHeader)) {
                    translated.appearance.thankYouMessageHeader = translation.thankYouMessageHeader
                    hasTranslation = true
                }
                if (!isUndefined(translation.thankYouMessageDescription)) {
                    translated.appearance.thankYouMessageDescription = translation.thankYouMessageDescription
                    hasTranslation = true
                }
                if (!isUndefined(translation.thankYouMessageCloseButtonText)) {
                    translated.appearance.thankYouMessageCloseButtonText = translation.thankYouMessageCloseButtonText
                    hasTranslation = true
                }
            } else if (hasThankYouTranslation(translation)) {
                // Nothing renders without appearance, but the locale did match a valid runtime translation.
                hasTranslation = true
            }
        }
    }

    // Always try to apply question-level translations (each question has its own translations field)
    const translatedResults = survey.questions.map((question) => mergeQuestionTranslation(question, targetLanguage))
    const translatedQuestions = translatedResults.map((r) => r.question)
    const anyQuestionTranslated = translatedResults.some((r) => r.hasChanges)

    // Track the first matched key from question translations if we don't have a survey-level match
    let questionMatchedKey: string | null = null
    if (!translationKey) {
        const firstMatch = translatedResults.find((r) => r.matchedKey)
        questionMatchedKey = firstMatch?.matchedKey || null
    }

    if (anyQuestionTranslated) {
        translated.questions = translatedQuestions
        hasTranslation = true
        logger.info(`Applied question-level translations for language: ${targetLanguage}`)
    }

    return {
        survey: translated,
        matchedKey: hasTranslation ? translationKey || questionMatchedKey : null,
    }
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
